use std::panic::{AssertUnwindSafe, catch_unwind};

use webrtc_audio_processing::{
    Processor,
    config::{Config, EchoCanceller, HighPassFilter},
};

pub struct GraneriAec {
    processor: Processor,
    frame_size: usize,
}

#[repr(C)]
pub struct GraneriAecStats {
    pub delay_ms: i32,
    pub echo_return_loss: f64,
    pub echo_return_loss_enhancement: f64,
    pub residual_echo_likelihood: f64,
    pub residual_echo_likelihood_recent_max: f64,
}

impl GraneriAec {
    fn new(sample_rate_hz: u32) -> Result<Self, ()> {
        let processor = Processor::new(sample_rate_hz).map_err(|_| ())?;
        processor.set_config(Config {
            echo_canceller: Some(EchoCanceller::Full {
                stream_delay_ms: None,
            }),
            high_pass_filter: Some(HighPassFilter::default()),
            ..Config::default()
        });
        let frame_size = processor.num_samples_per_frame();
        Ok(Self {
            processor,
            frame_size,
        })
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_create(sample_rate_hz: u32) -> *mut GraneriAec {
    catch_unwind(|| {
        GraneriAec::new(sample_rate_hz)
            .map(Box::new)
            .map(Box::into_raw)
            .unwrap_or(std::ptr::null_mut())
    })
    .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_destroy(aec: *mut GraneriAec) {
    if aec.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(aec));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_frame_size(aec: *const GraneriAec) -> usize {
    if aec.is_null() {
        return 0;
    }

    unsafe { (*aec).frame_size }
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_process_render_frame(
    aec: *mut GraneriAec,
    samples: *mut f32,
    sample_count: usize,
) -> bool {
    if aec.is_null() || samples.is_null() {
        return false;
    }

    catch_unwind(AssertUnwindSafe(|| {
        let aec = unsafe { &mut *aec };
        if sample_count != aec.frame_size {
            return false;
        }

        let samples = unsafe { std::slice::from_raw_parts(samples, sample_count) };
        aec.processor.analyze_render_frame([samples]).is_ok()
    }))
    .unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_process_capture_frame(
    aec: *mut GraneriAec,
    samples: *mut f32,
    sample_count: usize,
) -> bool {
    if aec.is_null() || samples.is_null() {
        return false;
    }

    catch_unwind(AssertUnwindSafe(|| {
        let aec = unsafe { &mut *aec };
        if sample_count != aec.frame_size {
            return false;
        }

        let samples = unsafe { std::slice::from_raw_parts_mut(samples, sample_count) };
        aec.processor.process_capture_frame([samples]).is_ok()
    }))
    .unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn graneri_aec_get_stats(aec: *const GraneriAec) -> GraneriAecStats {
    if aec.is_null() {
        return GraneriAecStats::unavailable();
    }

    catch_unwind(AssertUnwindSafe(|| {
        let stats = unsafe { &*aec }.processor.get_stats();
        GraneriAecStats {
            delay_ms: stats.delay_ms.map_or(-1, |value| value as i32),
            echo_return_loss: stats.echo_return_loss.unwrap_or(f64::NAN),
            echo_return_loss_enhancement: stats.echo_return_loss_enhancement.unwrap_or(f64::NAN),
            residual_echo_likelihood: stats.residual_echo_likelihood.unwrap_or(f64::NAN),
            residual_echo_likelihood_recent_max: stats
                .residual_echo_likelihood_recent_max
                .unwrap_or(f64::NAN),
        }
    }))
    .unwrap_or_else(|_| GraneriAecStats::unavailable())
}

impl GraneriAecStats {
    fn unavailable() -> Self {
        Self {
            delay_ms: -1,
            echo_return_loss: f64::NAN,
            echo_return_loss_enhancement: f64::NAN,
            residual_echo_likelihood: f64::NAN,
            residual_echo_likelihood_recent_max: f64::NAN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE_HZ: u32 = 48_000;

    struct AecHandle(*mut GraneriAec);

    impl AecHandle {
        fn new() -> Self {
            let aec = graneri_aec_create(SAMPLE_RATE_HZ);
            assert!(!aec.is_null());
            Self(aec)
        }

        fn frame_size(&self) -> usize {
            let frame_size = graneri_aec_frame_size(self.0);
            assert!(frame_size > 0);
            frame_size
        }
    }

    impl Drop for AecHandle {
        fn drop(&mut self) {
            graneri_aec_destroy(self.0);
        }
    }

    #[test]
    fn null_handles_return_safe_defaults() {
        assert_eq!(graneri_aec_frame_size(std::ptr::null()), 0);
        assert!(!graneri_aec_process_render_frame(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        ));
        assert!(!graneri_aec_process_capture_frame(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        ));

        let stats = graneri_aec_get_stats(std::ptr::null());
        assert_eq!(stats.delay_ms, -1);
        assert!(stats.echo_return_loss.is_nan());
        assert!(stats.echo_return_loss_enhancement.is_nan());
        assert!(stats.residual_echo_likelihood.is_nan());
        assert!(stats.residual_echo_likelihood_recent_max.is_nan());
    }

    #[test]
    fn frame_processing_rejects_null_and_wrong_sized_buffers() {
        let aec = AecHandle::new();
        let frame_size = aec.frame_size();
        let mut samples = vec![0.0_f32; frame_size];

        assert!(!graneri_aec_process_render_frame(
            aec.0,
            std::ptr::null_mut(),
            frame_size,
        ));
        assert!(!graneri_aec_process_capture_frame(
            aec.0,
            std::ptr::null_mut(),
            frame_size,
        ));
        assert!(!graneri_aec_process_render_frame(
            aec.0,
            samples.as_mut_ptr(),
            frame_size - 1,
        ));
        assert!(!graneri_aec_process_capture_frame(
            aec.0,
            samples.as_mut_ptr(),
            frame_size - 1,
        ));
    }

    #[test]
    fn processes_valid_render_and_capture_frames() {
        let aec = AecHandle::new();
        let frame_size = aec.frame_size();
        let mut render = sine_frame(frame_size, SAMPLE_RATE_HZ, 440.0, 0.2);
        let mut capture = render
            .iter()
            .enumerate()
            .map(|(index, echo)| {
                let local = sine_sample(index, SAMPLE_RATE_HZ, 1_200.0, 0.03);
                (*echo * 0.6 + local).clamp(-1.0, 1.0)
            })
            .collect::<Vec<_>>();

        assert!(graneri_aec_process_render_frame(
            aec.0,
            render.as_mut_ptr(),
            frame_size,
        ));
        assert!(graneri_aec_process_capture_frame(
            aec.0,
            capture.as_mut_ptr(),
            frame_size,
        ));

        let stats = graneri_aec_get_stats(aec.0);
        assert!(stats.delay_ms >= -1);
    }

    fn sine_frame(
        frame_size: usize,
        sample_rate_hz: u32,
        frequency_hz: f64,
        amplitude: f32,
    ) -> Vec<f32> {
        (0..frame_size)
            .map(|index| sine_sample(index, sample_rate_hz, frequency_hz, amplitude))
            .collect()
    }

    fn sine_sample(index: usize, sample_rate_hz: u32, frequency_hz: f64, amplitude: f32) -> f32 {
        ((index as f64 * 2.0 * std::f64::consts::PI * frequency_hz / sample_rate_hz as f64).sin()
            as f32)
            * amplitude
    }
}
