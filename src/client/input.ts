import { assert, assertNever, InvariantError } from '@sim/assert';
import { ErrorCode, InputBit, InputDir } from '@sim/enums';
import { encodeInputMask, resolveOppositeDirections } from '@sim/input';
import { KeyAction } from './enums';

export enum KeyPreset {
  KeyboardA = 0,
  KeyboardB = 1,
}

export type KeyBindingMap = Record<KeyAction, string>;

const STORAGE_KEY = 'bb.keys.v1';
const STICK_DEADZONE = 0.35;
const STICK_TILT_THRESHOLD = 0.75;
const STICK_COS_EDGE = Math.cos(Math.PI / 8);

export const ALL_KEY_ACTIONS: readonly KeyAction[] = [
  KeyAction.Left,
  KeyAction.Right,
  KeyAction.Up,
  KeyAction.Down,
  KeyAction.Jump,
  KeyAction.Attack,
  KeyAction.Heavy,
  KeyAction.Special,
  KeyAction.Guard,
  KeyAction.Grab,
  KeyAction.Use,
  KeyAction.Taunt,
];

const PRESET_A: KeyBindingMap = {
  [KeyAction.Up]: 'KeyW',
  [KeyAction.Left]: 'KeyA',
  [KeyAction.Down]: 'KeyS',
  [KeyAction.Right]: 'KeyD',
  [KeyAction.Jump]: 'Space',
  [KeyAction.Attack]: 'KeyJ',
  [KeyAction.Heavy]: 'KeyK',
  [KeyAction.Special]: 'KeyL',
  [KeyAction.Guard]: 'ShiftLeft',
  [KeyAction.Grab]: 'KeyU',
  [KeyAction.Use]: 'KeyE',
  [KeyAction.Taunt]: 'KeyT',
};

const PRESET_B: KeyBindingMap = {
  [KeyAction.Left]: 'ArrowLeft',
  [KeyAction.Right]: 'ArrowRight',
  [KeyAction.Up]: 'ArrowUp',
  [KeyAction.Down]: 'ArrowDown',
  [KeyAction.Jump]: 'Space',
  [KeyAction.Attack]: 'KeyZ',
  [KeyAction.Heavy]: 'KeyC',
  [KeyAction.Special]: 'KeyX',
  [KeyAction.Guard]: 'KeyA',
  [KeyAction.Grab]: 'KeyD',
  [KeyAction.Use]: 'KeyS',
  [KeyAction.Taunt]: 'KeyQ',
};

function presetMap(preset: KeyPreset): KeyBindingMap {
  switch (preset) {
    case KeyPreset.KeyboardA:
      return { ...PRESET_A };
    case KeyPreset.KeyboardB:
      return { ...PRESET_B };
    default:
      return assertNever(preset, 'presetMap');
  }
}

function actionToBit(action: KeyAction): InputBit {
  switch (action) {
    case KeyAction.Jump:
      return InputBit.Jump;
    case KeyAction.Attack:
      return InputBit.Attack;
    case KeyAction.Heavy:
      return InputBit.Heavy;
    case KeyAction.Special:
      return InputBit.Special;
    case KeyAction.Guard:
      return InputBit.Guard;
    case KeyAction.Grab:
      return InputBit.Grab;
    case KeyAction.Use:
      return InputBit.Use;
    case KeyAction.Taunt:
      return InputBit.Taunt;
    case KeyAction.Left:
    case KeyAction.Right:
    case KeyAction.Up:
    case KeyAction.Down:
      return InputBit.None;
    default:
      return assertNever(action, 'actionToBit');
  }
}

function parseSavedBindings(raw: string): KeyBindingMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InvariantError(ErrorCode.SchemaValidationFailed, `Corrupt ${STORAGE_KEY} JSON: ${String(err)}`);
  }
  assert(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), ErrorCode.SchemaValidationFailed, `${STORAGE_KEY} must be an object`);
  const rec = parsed as Record<string, unknown>;
  const keys = Object.keys(rec);
  assert(keys.length === ALL_KEY_ACTIONS.length, ErrorCode.SchemaValidationFailed, `${STORAGE_KEY} must contain exactly ${ALL_KEY_ACTIONS.length} entries`);

  const out = {} as KeyBindingMap;
  const seenCodes = new Set<string>();
  for (const action of ALL_KEY_ACTIONS) {
    const val = rec[String(action)];
    assert(typeof val === 'string' && val.length > 0 && val.length <= 32, ErrorCode.SchemaValidationFailed, `Invalid key code for KeyAction.${action}`);
    assert(!seenCodes.has(val), ErrorCode.SchemaValidationFailed, `Duplicate key code "${val}" in ${STORAGE_KEY}`);
    seenCodes.add(val);
    out[action] = val;
  }
  return out;
}

function stickToDir(x: number, y: number): { dir: InputDir; isTilt: boolean } {
  const mag = Math.hypot(x, y);
  if (mag < STICK_DEADZONE) return { dir: InputDir.Neutral, isTilt: false };
  const nx = x / mag;
  const ny = -y / mag; // Gamepad Y is +down; sim Y is +up
  const isTilt = mag < STICK_TILT_THRESHOLD;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  if (ax >= STICK_COS_EDGE) return { dir: nx > 0 ? InputDir.Right : InputDir.Left, isTilt };
  if (ay >= STICK_COS_EDGE) return { dir: ny > 0 ? InputDir.Up : InputDir.Down, isTilt };
  if (ny > 0) return { dir: nx > 0 ? InputDir.UpRight : InputDir.UpLeft, isTilt };
  return { dir: nx > 0 ? InputDir.DownRight : InputDir.DownLeft, isTilt };
}

function btnPressed(gp: Gamepad, idx: number): boolean {
  const b = gp.buttons[idx];
  return b !== undefined && b.pressed;
}

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  switch (code) {
    case 'Space': return 'Space';
    case 'ShiftLeft':
    case 'ShiftRight': return 'Shift';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ControlLeft':
    case 'ControlRight': return 'Ctrl';
    case 'AltLeft':
    case 'AltRight': return 'Alt';
    case 'Enter': return 'Enter';
    case 'Tab': return 'Tab';
    case 'Escape': return 'Esc';
    default: return code;
  }
}

export class InputCollector {
  private bindings: KeyBindingMap;
  private readonly pressed = new Set<string>();
  private lastHorizontal: -1 | 0 | 1 = 0;
  private attached = false;
  private tapJump = false;
  private touchDir: InputDir = InputDir.Neutral;
  private touchTilt = false;
  private touchBits = 0;
  private latchedBits = 0;
  private latchedDir: InputDir = InputDir.Neutral;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) {
      if (e.code === this.bindings[KeyAction.Left]) this.lastHorizontal = -1;
      else if (e.code === this.bindings[KeyAction.Right]) this.lastHorizontal = 1;
      for (const action of ALL_KEY_ACTIONS) {
        if (this.bindings[action] === e.code) {
          const bit = actionToBit(action);
          if (bit !== InputBit.None) this.latchedBits |= bit;
          break;
        }
      }
    }
    this.pressed.add(e.code);
    if (!e.repeat) {
      const snapDir = resolveOppositeDirections(
        this.pressed.has(this.bindings[KeyAction.Left]),
        this.pressed.has(this.bindings[KeyAction.Right]),
        this.pressed.has(this.bindings[KeyAction.Up]),
        this.pressed.has(this.bindings[KeyAction.Down]),
        this.lastHorizontal,
      );
      if (snapDir !== InputDir.Neutral) this.latchedDir = snapDir;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.lastHorizontal = 0;
    this.latchedBits = 0;
    this.latchedDir = InputDir.Neutral;
    this.clearTouch();
  };

  public constructor(storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    const saved = storage?.getItem(STORAGE_KEY) ?? null;
    this.bindings = saved !== null ? parseSavedBindings(saved) : presetMap(KeyPreset.KeyboardA);
  }

  public attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
    this.latchedBits = 0;
    this.latchedDir = InputDir.Neutral;
    this.clearTouch();
    this.attached = false;
  }

  public setTapJump(enabled: boolean): void {
    this.tapJump = enabled;
  }

  public setTouchStick(dir: InputDir, isTilt: boolean): void {
    assert(Number.isInteger(dir) && dir >= InputDir.Neutral && dir <= InputDir.UpLeft, ErrorCode.InvalidEnumValue, `Invalid InputDir: ${String(dir)}`);
    this.touchDir = dir;
    this.touchTilt = isTilt;
    if (dir !== InputDir.Neutral) this.latchedDir = dir;
  }

  public setTouchBit(bit: InputBit, active: boolean): void {
    assert((bit & InputBit.DirMask) === 0 && (bit & ~0xffff) === 0, ErrorCode.InvalidEnumValue, `Invalid InputBit: ${String(bit)}`);
    if (active) {
      if ((this.touchBits & bit) === 0) this.latchedBits |= bit;
      this.touchBits |= bit;
    } else {
      this.touchBits &= ~bit;
    }
  }

  public clearTouch(): void {
    this.touchDir = InputDir.Neutral;
    this.touchTilt = false;
    this.touchBits = 0;
    this.latchedBits = 0;
    this.latchedDir = InputDir.Neutral;
  }

  public getBindings(): KeyBindingMap {
    return { ...this.bindings };
  }

  public setPreset(preset: KeyPreset): void {
    this.bindings = presetMap(preset);
    this.save();
  }

  public rebind(action: KeyAction, code: string): void {
    assert(ALL_KEY_ACTIONS.includes(action), ErrorCode.InvalidEnumValue, `Invalid KeyAction: ${String(action)}`);
    assert(typeof code === 'string' && code.length > 0 && code.length <= 32, ErrorCode.InvariantViolation, `Invalid key code: ${code}`);
    for (const other of ALL_KEY_ACTIONS) {
      if (other !== action && this.bindings[other] === code) {
        this.bindings[other] = this.bindings[action];
      }
    }
    this.bindings[action] = code;
    this.save();
  }

  public pollMask(): number {
    const left = this.pressed.has(this.bindings[KeyAction.Left]);
    const right = this.pressed.has(this.bindings[KeyAction.Right]);
    const up = this.pressed.has(this.bindings[KeyAction.Up]);
    const down = this.pressed.has(this.bindings[KeyAction.Down]);

    let dir = resolveOppositeDirections(left, right, up, down, this.lastHorizontal);
    let bits = 0;

    for (const action of ALL_KEY_ACTIONS) {
      const bit = actionToBit(action);
      if (bit !== InputBit.None && this.pressed.has(this.bindings[action])) {
        bits |= bit;
      }
    }

    // Xbox standard Gamepad polling
    const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const gpLeft = btnPressed(gp, 14);
      const gpRight = btnPressed(gp, 15);
      const gpUp = btnPressed(gp, 12);
      const gpDown = btnPressed(gp, 13);
      if (gpLeft || gpRight || gpUp || gpDown) {
        dir = resolveOppositeDirections(gpLeft, gpRight, gpUp, gpDown, gpRight ? 1 : gpLeft ? -1 : 0);
      } else {
        const axX = gp.axes[0] ?? 0;
        const axY = gp.axes[1] ?? 0;
        const stick = stickToDir(axX, axY);
        if (stick.dir !== InputDir.Neutral) {
          dir = stick.dir;
          if (stick.isTilt) bits |= InputBit.Tilt;
        }
      }
      if (btnPressed(gp, 0)) bits |= InputBit.Jump;    // A
      if (btnPressed(gp, 2)) bits |= InputBit.Attack;  // X
      if (btnPressed(gp, 3)) bits |= InputBit.Heavy;   // Y
      if (btnPressed(gp, 1)) bits |= InputBit.Special; // B
      if (btnPressed(gp, 5) || btnPressed(gp, 7)) bits |= InputBit.Guard; // RB / RT
      if (btnPressed(gp, 4)) bits |= InputBit.Grab;    // LB
      if (btnPressed(gp, 6)) bits |= InputBit.Use;     // LT
      if (btnPressed(gp, 8)) bits |= InputBit.Taunt;   // Back
      // Right stick flick -> Heavy
      const rx = gp.axes[2] ?? 0;
      const ry = gp.axes[3] ?? 0;
      if (Math.hypot(rx, ry) >= STICK_TILT_THRESHOLD) bits |= InputBit.Heavy;
      break;
    }

    // Virtual touch input
    if (this.touchDir !== InputDir.Neutral) {
      dir = this.touchDir;
      if (this.touchTilt) bits |= InputBit.Tilt;
    }
    bits |= this.touchBits;

    // Merge latched rising presses from brief taps between frames, then clear latch
    if (this.latchedBits !== 0) {
      bits |= this.latchedBits;
      if (dir === InputDir.Neutral && this.latchedDir !== InputDir.Neutral) dir = this.latchedDir;
    }
    this.latchedBits = 0;
    this.latchedDir = InputDir.Neutral;

    // Optional tap-jump
    if (this.tapJump && (dir === InputDir.Up || dir === InputDir.UpLeft || dir === InputDir.UpRight)) {
      bits |= InputBit.Jump;
    }

    // Guard + Attack chord -> Grab (GDD 3.3)
    if ((bits & InputBit.Guard) !== 0 && (bits & InputBit.Attack) !== 0) {
      bits |= InputBit.Grab;
    }

    return encodeInputMask(dir, bits);
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
  }
}
