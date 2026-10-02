export const ROOM_WIDTH = 18;
export const ROOM_DEPTH = 16;

export const EASEL = Object.freeze({ x: 0, z: -3 });
export const EASEL_COLLISION_RADIUS = 1.15;

const PLAYER_WALL_MARGIN = 0.8;

export const PLAYER_BOUNDS = Object.freeze({
  minX: -ROOM_WIDTH / 2 + PLAYER_WALL_MARGIN,
  maxX: ROOM_WIDTH / 2 - PLAYER_WALL_MARGIN,
  minZ: -ROOM_DEPTH / 2 + PLAYER_WALL_MARGIN,
  maxZ: ROOM_DEPTH / 2 - PLAYER_WALL_MARGIN,
});

export function canOccupyColoringRoom(x, z) {
  if (x < PLAYER_BOUNDS.minX || x > PLAYER_BOUNDS.maxX) return false;
  if (z < PLAYER_BOUNDS.minZ || z > PLAYER_BOUNDS.maxZ) return false;
  return (x - EASEL.x) ** 2 + (z - EASEL.z) ** 2 >= EASEL_COLLISION_RADIUS ** 2;
}
