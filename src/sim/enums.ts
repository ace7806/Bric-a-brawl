/**
 * Canonical numeric enums for the Bric-a-Brawl simulation.
 * Every finite domain uses an enum rather than raw string literals, enabling
 * exhaustive switch checks and direct integer wire quantisation.
 */

export enum ErrorCode {
  InvariantViolation = 1,
  InvalidEnumValue = 2,
  SchemaValidationFailed = 3,
  NonFiniteNumber = 4,
  IndexOutOfBounds = 5,
  UnreachableCase = 6,
  MissingRequiredEntry = 7,
  ProtocolMismatch = 8,
  BudgetExceeded = 9,
  TransportError = 10,
  PhysicsNotInitialized = 11,
}

export enum FighterId {
  Earl = 0,
  Grog = 1,
  Nesta = 2,
  Moss = 3,
}

export enum NestaSize {
  Big = 0,
  Mid = 1,
  Small = 2,
}

export enum ArenaId {
  Willow = 0,
  HighTea = 1,
  MendedBowl = 2,
  Saucer = 3,
}

export enum MoveId {
  None = 0,
  Jab1 = 1,
  Jab2 = 2,
  Jab3 = 3,
  Ftilt = 4,
  Utilt = 5,
  Dtilt = 6,
  Dash = 7,
  Fheavy = 8,
  Uheavy = 9,
  Dheavy = 10,
  Nair = 11,
  Fair = 12,
  Bair = 13,
  Uair = 14,
  Dair = 15,
  Grab = 16,
  Fthrow = 17,
  Bthrow = 18,
  Uthrow = 19,
  Dthrow = 20,
  Nspec = 21,
  Sspec = 22,
  Uspec = 23,
  Dspec = 24,
  Ledge = 25,
  Getup = 26,
}

export enum MoveClass {
  Light = 0,
  Heavy = 1,
  Air = 2,
  Grab = 3,
  Throw = 4,
  Special = 5,
}

export enum CancelKind {
  None = 0,
  Chain = 1,
  Special = 2,
}

export enum FighterState {
  Idle = 0,
  Walk = 1,
  Dash = 2,
  Run = 3,
  Skid = 4,
  JumpSquat = 5,
  Airborne = 6,
  Attack = 7,
  Guard = 8,
  GuardRelease = 9,
  GuardStun = 10,
  GuardBreak = 11,
  Parry = 12,
  ParryStun = 13,
  Roll = 14,
  SpotDodge = 15,
  AirDodge = 16,
  Grabbing = 17,
  Held = 18,
  Hitstun = 19,
  Tumble = 20,
  LedgeHang = 21,
  LedgeGetup = 22,
  Helpless = 23,
  Respawn = 24,
  Teaspoon = 25,
  Eliminated = 26,
  LandingLag = 27,
  ChargingHeavy = 28,
}

export enum FighterFlag {
  None = 0,
  FacingRight = 1 << 0,
  Grounded = 1 << 1,
  Invuln = 1 << 2,
  Piping = 1 << 3,
  Armour = 1 << 4,
  Rooted = 1 << 5,
  Slippery = 1 << 6,
  FastFall = 1 << 7,
}

export enum InputDir {
  Neutral = 0,
  Up = 1,
  UpRight = 2,
  Right = 3,
  DownRight = 4,
  Down = 5,
  DownLeft = 6,
  Left = 7,
  UpLeft = 8,
}

export enum InputBit {
  None = 0,
  DirMask = 0x000f,
  Tilt = 1 << 4,
  Jump = 1 << 5,
  Attack = 1 << 6,
  Heavy = 1 << 7,
  Special = 1 << 8,
  Guard = 1 << 9,
  Grab = 1 << 10,
  Use = 1 << 11,
  Taunt = 1 << 12,
}

export enum MotionInput {
  None = 0,
  Qcf236 = 1,
  Dp623 = 2,
  Qcb214 = 3,
}

export enum ChunkState {
  Intact = 0,
  Crazed = 1,
  Loose = 2,
  Falling = 3,
  Gone = 4,
}

export enum PlatformKind {
  Soft = 0,
  SolidMoving = 1,
}

export enum BowlHalf {
  None = 0,
  Left = 1,
  Right = 2,
}

export enum TimelineAction {
  Craze = 0,
  Drop = 1,
  LastCall = 2,
  SuddenDeath = 3,
  SinkOne = 4,
  Sink = 5,
  Hazard = 6,
  StemSnap = 7,
  Split = 8,
  Tilt = 9,
}

export enum HazardId {
  Pour = 0,
  Updraft = 1,
}

export enum GadgetId {
  None = 0,
  Bellows = 1,
  Plunger = 2,
  Cork = 3,
  Pepper = 4,
  Toaster = 5,
  Jam = 6,
  Timer = 7,
  Hoover = 8,
  Magnet = 9,
}

export enum GadgetTier {
  A = 0,
  B = 1,
  C = 2,
}

export enum GadgetVerb {
  Push = 0,
  Pull = 1,
  Launch = 2,
  Reverse = 3,
  Stick = 4,
  SuckAndSpit = 5,
  AttractAndRepel = 6,
}

export enum WorldGadgetState {
  Parcel = 0,
  Grounded = 1,
  ArmedToaster = 2,
  Thrown = 3,
}

export enum ProjectileKind {
  SteamPuff = 0,
  Cork = 1,
  Plunger = 2,
  Hook = 3,
  Sinker = 4,
  Bobber = 5,
  Shell = 6,
  Boot = 7,
  JamJar = 8,
  ThrownGadget = 9,
  RubbleThrow = 10,
}

export enum MatchMode {
  FreeForAll = 0,
  Teams = 1,
  Practice = 2,
}

export enum TeamId {
  None = 0,
  Cobalt = 1,
  Oxblood = 2,
}

export enum SimEventKind {
  Hit = 0,
  Block = 1,
  Parry = 2,
  GuardBreak = 3,
  Grab = 4,
  Throw = 5,
  Launch = 6,
  Ko = 7,
  Respawn = 8,
  Shed = 9,
  ChunkState = 10,
  PlatformState = 11,
  Hazard = 12,
  GadgetSpawn = 13,
  GadgetTake = 14,
  GadgetUse = 15,
  GadgetGone = 16,
  Timeline = 17,
  SuddenDeath = 18,
  RoundEnd = 19,
  GiltBreak = 20,
  Bounce = 21,
  Tech = 22,
  TeaspoonTap = 23,
  Sneeze = 24,
  Rewind = 25,
}

export enum KoCause {
  FighterMove = 0,
  Gadget = 1,
  FallingChunk = 2,
  Hazard = 3,
  SelfDestruct = 4,
  HardEnd = 5,
}

export enum CrackSource {
  Slam = 0,
  Move = 1,
  Teaspoon = 2,
  FallingChunk = 3,
  Timeline = 4,
}

export enum HitOutcome {
  Miss = 0,
  Hit = 1,
  Block = 2,
  Parry = 3,
  Armour = 4,
  Invuln = 5,
}

export const ALL_FIGHTER_IDS: readonly FighterId[] = [
  FighterId.Earl,
  FighterId.Grog,
  FighterId.Nesta,
  FighterId.Moss,
] as const;

export const ALL_ARENA_IDS: readonly ArenaId[] = [
  ArenaId.Willow,
  ArenaId.HighTea,
  ArenaId.MendedBowl,
] as const;

export const ALL_GADGET_IDS: readonly GadgetId[] = [
  GadgetId.Bellows,
  GadgetId.Plunger,
  GadgetId.Cork,
  GadgetId.Pepper,
  GadgetId.Toaster,
  GadgetId.Jam,
  GadgetId.Timer,
  GadgetId.Hoover,
  GadgetId.Magnet,
] as const;
