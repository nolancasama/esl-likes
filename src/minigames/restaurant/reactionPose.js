function smoothstep(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - (2 * clamped));
}

function node(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

/** Pure result-stage offsets, applied on top of each character's captured rest pose. */
export function reactionPose(reaction, seconds) {
  const time = Math.max(0, Number(seconds) || 0);
  const blend = smoothstep(Math.min(1, time / 0.25));
  const pose = { rootY: 0, rootRotationY: 0, nodes: {}, positions: {} };

  if (reaction === 'celebrate') {
    const hopCycle = time % 0.5;
    const hopping = time < 1.5 ? Math.sin(hopCycle / 0.5 * Math.PI) : 0;
    const pump = time < 1.5 ? Math.sin(time * Math.PI * 4) * 0.35 : 0;
    const cheerTwist = time < 1.5 ? Math.sin(time * Math.PI * 2) * 0.12 : 0;
    pose.rootY = Math.max(0, hopping) * 0.45;
    pose.nodes['arm-left'] = node(0, 0, (2.4 + pump) * blend);
    pose.nodes['arm-right'] = node(0, 0, (-2.4 - pump) * blend);
    pose.nodes.torso = node(0, cheerTwist * blend, 0);
  } else if (reaction === 'dejected') {
    const sigh = Math.sin(Math.min(1, time / 1.2) * Math.PI) * -0.035;
    const shakeStart = 0.5;
    const shakeEnd = 2.7;
    let shake = 0;
    if (time > shakeStart && time < shakeEnd) {
      const edge = Math.min(
        smoothstep((time - shakeStart) / 0.25),
        smoothstep((shakeEnd - time) / 0.25),
      );
      shake = Math.sin((time - shakeStart) / 1.1 * Math.PI * 2) * 0.3 * edge;
    }
    pose.rootY = sigh * blend;
    pose.nodes.head = node(0.45 * blend, shake, 0);
    pose.nodes.torso = node(0.25 * blend, 0, 0);
    pose.nodes['arm-left'] = node(0.22 * blend, 0, -0.1 * blend);
    pose.nodes['arm-right'] = node(0.22 * blend, 0, 0.1 * blend);
  } else if (reaction === 'shrug') {
    const lift = Math.sin(Math.min(1, time / 0.45) * Math.PI) * 0.04;
    const nod = time > 0.65 && time < 1.55
      ? Math.sin((time - 0.65) * Math.PI * 2.2) * 0.08
      : 0;
    pose.nodes['arm-left'] = node(-0.5 * blend, 0, 0.55 * blend);
    pose.nodes['arm-right'] = node(-0.5 * blend, 0, -0.55 * blend);
    pose.nodes.head = node(nod * blend, 0, 0.15 * blend);
    pose.positions.torso = node(0, lift * blend, 0);
  }

  return pose;
}
