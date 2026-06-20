export const HOSTED_TURN_INPUT_ACTIVITY_MAILBOX = "mailbox";
export const HOSTED_TURN_INPUT_ACTIVITY_STEER = "steer";

export const createHostedTurnInputBuffer = () => {
	const pendingSteerInput = [];
	const pendingMailboxInput = [];
	const activitySubscribers = new Set();
	let acceptsMailboxDelivery = true;

	const notifyActivity = (activity) => {
		for (const subscriber of activitySubscribers) {
			subscriber(activity);
		}
	};

	const getPendingActivity = () => {
		if (pendingSteerInput.length > 0) {
			return HOSTED_TURN_INPUT_ACTIVITY_STEER;
		}
		if (pendingMailboxInput.length > 0) {
			return HOSTED_TURN_INPUT_ACTIVITY_MAILBOX;
		}
		return null;
	};

	const pushInput = (target, input) => {
		if (Array.isArray(input)) {
			target.push(...input);
			return;
		}

		target.push(input);
	};

	return {
		acceptMailboxDeliveryForCurrentTurn() {
			acceptsMailboxDelivery = true;
		},
		clear() {
			pendingSteerInput.length = 0;
			pendingMailboxInput.length = 0;
			acceptsMailboxDelivery = true;
		},
		deferMailboxDeliveryToNextTurn() {
			if (pendingSteerInput.length > 0) {
				return;
			}
			acceptsMailboxDelivery = false;
		},
		enqueueMailboxInput(input) {
			pushInput(pendingMailboxInput, input);
			notifyActivity(HOSTED_TURN_INPUT_ACTIVITY_MAILBOX);
		},
		extendSteerInput(input) {
			pushInput(pendingSteerInput, input);
			acceptsMailboxDelivery = true;
			notifyActivity(HOSTED_TURN_INPUT_ACTIVITY_STEER);
		},
		hasPendingInput() {
			return (
				pendingSteerInput.length > 0 ||
				(acceptsMailboxDelivery && pendingMailboxInput.length > 0)
			);
		},
		hasPendingMailboxInput() {
			return pendingMailboxInput.length > 0;
		},
		subscribeActivity(listener) {
			activitySubscribers.add(listener);
			return {
				pendingActivity: getPendingActivity(),
				unsubscribe: () => {
					activitySubscribers.delete(listener);
				},
			};
		},
		takeAllForReplacement() {
			return [...pendingSteerInput.splice(0), ...pendingMailboxInput.splice(0)];
		},
		takeForCurrentTurn() {
			const pendingInput = pendingSteerInput.splice(0);
			if (acceptsMailboxDelivery) {
				pendingInput.push(...pendingMailboxInput.splice(0));
			}
			return pendingInput;
		},
	};
};
