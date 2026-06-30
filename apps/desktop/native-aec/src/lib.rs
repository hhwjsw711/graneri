use std::panic::{catch_unwind, AssertUnwindSafe};

use webrtc_audio_processing::{
	config::{Config, EchoCanceller, HighPassFilter},
	Processor,
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
			echo_return_loss_enhancement: stats
				.echo_return_loss_enhancement
				.unwrap_or(f64::NAN),
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
