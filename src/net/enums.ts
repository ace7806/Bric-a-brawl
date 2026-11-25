/** Canonical numeric enums for the networking layer. */

export enum ChannelKind {
  Reliable = 0,
  Unreliable = 1,
}

export enum NetMessageKind {
  Hello = 0,
  Bye = 1,
  Roster = 2,
  Events = 3,
  Say = 4,
  Host = 5,
  Perf = 6,
  Input = 7,
  Snapshot = 8,
}

export enum ByeReason {
  VersionMismatch = 0,
  RoomFull = 1,
  Kicked = 2,
}

export enum RoomPhase {
  Lobby = 0,
  Countdown = 1,
  Round = 2,
  Results = 3,
}

export enum SlotStatus {
  Connected = 0,
  Loading = 1,
  Ready = 2,
  Spectating = 3,
  Bot = 4,
}

export enum HostAction {
  BenchReport = 0,
  Offer = 1,
  Take = 2,
  RequestHost = 3,
}

export enum QuickPhraseId {
  GoingOnce = 0,
  Sold = 1,
  MindTheGlaze = 2,
  GenuinePorcelain = 3,
  ChippedAtTheRim = 4,
  ReserveNotMet = 5,
  OneMoreLot = 6,
  HandleWithCare = 7,
}

export enum NetsimProfileId {
  Lan = 0,
  Typical = 1,
  Far = 2,
  Limit = 3,
  Wifi = 4,
  Awful = 5,
  Stall = 6,
  Churn = 7,
}

export enum ConnectionState {
  Idle = 0,
  Signalling = 1,
  Connected = 2,
  PeerFailed = 3,
  RelayFailed = 4,
  VersionMismatch = 5,
}
