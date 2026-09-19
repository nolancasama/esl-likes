/** Pure chooser for the Restaurant's single current Space action. */
export function chooseAction({
  speechCooldown = false,
  carried = false,
  lockedQuestion = null,
  questionCandidate = null,
  nearReturn = false,
  beltDish = null,
  deliverTarget = null,
} = {}) {
  if (speechCooldown || lockedQuestion) return 'none';
  if (questionCandidate) return 'talk';
  if (carried) {
    if (nearReturn) return 'return';
    if (beltDish) return 'exchange';
    if (deliverTarget) return 'deliver';
    return 'none';
  }
  return beltDish ? 'collect' : 'none';
}
