export const RESTAURANT_ONBOARDING_STEPS = Object.freeze({
  APPROACH: 'approach',
  ASK: 'ask',
  TO_CONVEYOR: 'toConveyor',
  DELIVER: 'deliver',
  DONE: 'done',
});

/** Pure first-customer guidance state. Scene objects stay in the controller. */
export function createRestaurantOnboarding({ enabled = true } = {}) {
  let step = enabled
    ? RESTAURANT_ONBOARDING_STEPS.APPROACH
    : RESTAURANT_ONBOARDING_STEPS.DONE;

  function advance(event) {
    if (step === RESTAURANT_ONBOARDING_STEPS.DONE) return step;

    if (event === 'customerResolved') {
      step = RESTAURANT_ONBOARDING_STEPS.DONE;
    } else if (event === 'enteredTalkRange'
      && step === RESTAURANT_ONBOARDING_STEPS.APPROACH) {
      step = RESTAURANT_ONBOARDING_STEPS.ASK;
    } else if (event === 'orderTaken'
      && (step === RESTAURANT_ONBOARDING_STEPS.APPROACH
        || step === RESTAURANT_ONBOARDING_STEPS.ASK)) {
      step = RESTAURANT_ONBOARDING_STEPS.TO_CONVEYOR;
    } else if (event === 'dishPickedUp'
      && step === RESTAURANT_ONBOARDING_STEPS.TO_CONVEYOR) {
      step = RESTAURANT_ONBOARDING_STEPS.DELIVER;
    } else if (event === 'dishReturned'
      && step === RESTAURANT_ONBOARDING_STEPS.DELIVER) {
      step = RESTAURANT_ONBOARDING_STEPS.TO_CONVEYOR;
    } else if (event === 'correctDelivery'
      && step === RESTAURANT_ONBOARDING_STEPS.DELIVER) {
      step = RESTAURANT_ONBOARDING_STEPS.DONE;
    }
    return step;
  }

  return {
    advance,
    get step() {
      return step;
    },
    get active() {
      return step !== RESTAURANT_ONBOARDING_STEPS.DONE;
    },
  };
}
