export const RESTAURANT_OWNERS = Object.freeze({
  PLAYER: 'player',
  RIVAL: 'rival',
});

export const RIVAL_MIN_HAND_AGE = 4;

function customerId(customer) {
  return customer?.id ?? customer?.index;
}

function copyPosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const copy = { x, z };
  const y = Number(position.y);
  if (Number.isFinite(y)) copy.y = y;
  return copy;
}

function publicCustomer(customer, serviceTime) {
  if (!customer) return null;
  return {
    id: customer.id,
    food: customer.food,
    position: copyPosition(customer.position),
    owner: customer.owner,
    reservedBy: customer.reservedBy,
    handRaised: customer.handRaisedAt !== null,
    handAge: customer.handRaisedAt === null ? 0 : serviceTime - customer.handRaisedAt,
  };
}

/**
 * Pure ownership registry for one Restaurant shift.
 *
 * Controller contract:
 * - `registerCustomer({ id, food, position? })` is called for every `seat`
 *   event. A newly registered (including replacement) customer is unclaimed.
 * - `raiseHand(id)` marks the service-clock instant at which the cue appears.
 * - `reservePlayer(id)` is called when a locked dwell begins, or when manual
 *   hold-to-talk / the reading fallback opens. At most one reservation exists.
 * - `releasePlayerReservation(id?)` is called when that attempt cancels before
 *   commit. `commitPlayer(id)` is called at the existing speech-focus commit.
 * - `claimRival(id)` is intentionally strict: it succeeds only for an
 *   unowned, unreserved raised hand at least `RIVAL_MIN_HAND_AGE` old.
 * - `resolveCustomer(id, { outcome })` removes the customer. `outcome` is
 *   `'served'` or `'left'`; only a served owned customer increments a waiter
 *   count. `progress.done` counts both outcomes.
 * - `advance(serviceDt)` advances hand ages. Invalid, negative, and zero
 *   deltas change nothing. When a registry is owned by `createRestaurantRival`,
 *   its `advance` method advances the registry; the controller must not also
 *   advance it separately.
 *
 * All returned customer objects are copies. The controller remains the owner
 * of scene objects and supplies positions only as plain `{ x, z }` data.
 */
export function createCustomerClaimRegistry() {
  const customers = new Map();
  let serviceTime = 0;
  let playerReservation = null;
  let resolved = 0;
  let playerServed = 0;
  let rivalServed = 0;

  function registerCustomer(customer) {
    const id = customerId(customer);
    if (id === null || id === undefined) throw new TypeError('customer id is required');
    if (customers.has(id)) return false;
    customers.set(id, {
      id,
      food: customer?.food ?? null,
      position: copyPosition(customer?.position),
      owner: null,
      reservedBy: null,
      handRaisedAt: null,
    });
    return true;
  }

  function updateCustomer(id, { food, position } = {}) {
    const customer = customers.get(id);
    if (!customer) return false;
    if (food !== undefined) customer.food = food;
    if (position !== undefined) customer.position = copyPosition(position);
    return true;
  }

  function raiseHand(id) {
    const customer = customers.get(id);
    if (!customer || customer.owner !== null) return false;
    if (customer.handRaisedAt === null) customer.handRaisedAt = serviceTime;
    return true;
  }

  function reservePlayer(id) {
    const customer = customers.get(id);
    if (!customer || customer.owner !== null || customer.handRaisedAt === null) return false;
    if (playerReservation !== null && playerReservation !== id) {
      const previous = customers.get(playerReservation);
      if (previous) previous.reservedBy = null;
    }
    playerReservation = id;
    customer.reservedBy = RESTAURANT_OWNERS.PLAYER;
    return true;
  }

  function releasePlayerReservation(id = playerReservation) {
    if (playerReservation === null || id !== playerReservation) return false;
    const customer = customers.get(playerReservation);
    if (customer) customer.reservedBy = null;
    playerReservation = null;
    return true;
  }

  function commitPlayer(id) {
    const customer = customers.get(id);
    if (!customer || customer.owner === RESTAURANT_OWNERS.RIVAL) return false;
    if (customer.owner === RESTAURANT_OWNERS.PLAYER) return true;
    if (customer.handRaisedAt === null) return false;
    if (playerReservation !== null && playerReservation !== id) return false;
    customer.owner = RESTAURANT_OWNERS.PLAYER;
    customer.reservedBy = null;
    if (playerReservation === id) playerReservation = null;
    return true;
  }

  function claimRival(id) {
    const customer = customers.get(id);
    if (!customer || customer.owner !== null || customer.reservedBy !== null
      || customer.handRaisedAt === null
      || serviceTime - customer.handRaisedAt < RIVAL_MIN_HAND_AGE) return false;
    customer.owner = RESTAURANT_OWNERS.RIVAL;
    return true;
  }

  function resolveCustomer(id, { outcome = 'left' } = {}) {
    const customer = customers.get(id);
    if (!customer || !['served', 'left'].includes(outcome)) return false;
    if (playerReservation === id) playerReservation = null;
    customers.delete(id);
    resolved += 1;
    if (outcome === 'served' && customer.owner === RESTAURANT_OWNERS.PLAYER) playerServed += 1;
    if (outcome === 'served' && customer.owner === RESTAURANT_OWNERS.RIVAL) rivalServed += 1;
    return true;
  }

  function advance(serviceDt) {
    const dt = Number(serviceDt);
    if (!Number.isFinite(dt) || dt <= 0) return [];
    serviceTime += dt;
    return [];
  }

  function getCustomer(id) {
    return publicCustomer(customers.get(id), serviceTime);
  }

  function listCustomers() {
    return [...customers.values()].map((customer) => publicCustomer(customer, serviceTime));
  }

  function longestWaitingUnclaimed(minimumAge = RIVAL_MIN_HAND_AGE) {
    const safeAge = Number.isFinite(Number(minimumAge)) ? Math.max(0, Number(minimumAge)) : 0;
    let selected = null;
    for (const customer of customers.values()) {
      if (customer.owner !== null || customer.reservedBy !== null || customer.handRaisedAt === null) continue;
      if (serviceTime - customer.handRaisedAt < safeAge) continue;
      if (!selected || customer.handRaisedAt < selected.handRaisedAt) selected = customer;
    }
    return publicCustomer(selected, serviceTime);
  }

  return {
    advance,
    registerCustomer,
    updateCustomer,
    raiseHand,
    reservePlayer,
    releasePlayerReservation,
    commitPlayer,
    claimRival,
    resolveCustomer,
    getCustomer,
    listCustomers,
    longestWaitingUnclaimed,
    get reservation() {
      return playerReservation;
    },
    get serviceTime() {
      return serviceTime;
    },
    get progress() {
      return { done: resolved };
    },
    get counts() {
      return { playerServed, rivalServed };
    },
  };
}
