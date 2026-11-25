import { InputBit, InputDir } from '@sim/enums';
import { useEffect, useRef, useState } from 'preact/hooks';

const STICK_MAX_R = 46;
const STICK_DEADZONE = 0.24;
const STICK_TILT_THRESHOLD = 0.68;
const STICK_COS_EDGE = Math.cos(Math.PI / 8);

function offsetToDir(dx: number, dy: number): { dir: InputDir; isTilt: boolean } {
  const dist = Math.hypot(dx, dy);
  const norm = Math.min(1, dist / STICK_MAX_R);
  if (norm < STICK_DEADZONE) return { dir: InputDir.Neutral, isTilt: false };
  const nx = dx / dist;
  const ny = -dy / dist; // screen Y is +down; sim Y is +up
  const isTilt = norm < STICK_TILT_THRESHOLD;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  if (ax >= STICK_COS_EDGE) return { dir: nx > 0 ? InputDir.Right : InputDir.Left, isTilt };
  if (ay >= STICK_COS_EDGE) return { dir: ny > 0 ? InputDir.Up : InputDir.Down, isTilt };
  if (ny > 0) return { dir: nx > 0 ? InputDir.UpRight : InputDir.UpLeft, isTilt };
  return { dir: nx > 0 ? InputDir.DownRight : InputDir.DownLeft, isTilt };
}

interface TouchButtonSpec {
  readonly bit: InputBit;
  readonly label: string;
  readonly cls: string;
}

const ACTION_BUTTONS: readonly TouchButtonSpec[] = [
  { bit: InputBit.Attack, label: 'Hit', cls: 'tb-hit' },
  { bit: InputBit.Jump, label: 'Jump', cls: 'tb-jump' },
  { bit: InputBit.Special, label: 'Spec', cls: 'tb-spec' },
  { bit: InputBit.Heavy, label: 'Heavy', cls: 'tb-heavy' },
  { bit: InputBit.Guard, label: 'Guard', cls: 'tb-guard' },
  { bit: InputBit.Grab, label: 'Grab', cls: 'tb-grab' },
  { bit: InputBit.Use, label: 'Item', cls: 'tb-item' },
];

export interface TouchControlsProps {
  readonly visible: boolean;
  readonly hasGadget: boolean;
  readonly onStick: (dir: InputDir, isTilt: boolean) => void;
  readonly onBit: (bit: InputBit, active: boolean) => void;
  readonly onClear: () => void;
}

export function TouchControls({ visible, hasGadget, onStick, onBit, onClear }: TouchControlsProps) {
  const stickZoneRef = useRef<HTMLDivElement | null>(null);
  const stickPointerId = useRef<number | null>(null);
  const stickOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [knob, setKnob] = useState<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const [heldMask, setHeldMask] = useState(0);
  const btnPointers = useRef<Map<number, InputBit>>(new Map());

  useEffect(() => {
    if (!visible) {
      stickPointerId.current = null;
      btnPointers.current.clear();
      setKnob({ x: 0, y: 0, active: false });
      setHeldMask(0);
      onClear();
    }
  }, [visible, onClear]);

  if (!visible) return null;

  const updateStickFromPoint = (clientX: number, clientY: number) => {
    const rawDx = clientX - stickOrigin.current.x;
    const rawDy = clientY - stickOrigin.current.y;
    const dist = Math.hypot(rawDx, rawDy);
    const scale = dist > STICK_MAX_R ? STICK_MAX_R / dist : 1;
    const cx = rawDx * scale;
    const cy = rawDy * scale;
    setKnob({ x: cx, y: cy, active: true });
    const { dir, isTilt } = offsetToDir(cx, cy);
    onStick(dir, isTilt);
  };

  const onStickDown = (e: PointerEvent) => {
    if (stickPointerId.current !== null) return;
    e.preventDefault();
    stickPointerId.current = e.pointerId;
    const el = stickZoneRef.current;
    if (el !== null) {
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      stickOrigin.current = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    } else {
      stickOrigin.current = { x: e.clientX, y: e.clientY };
    }
    updateStickFromPoint(e.clientX, e.clientY);
  };

  const onStickMove = (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId.current) return;
    e.preventDefault();
    updateStickFromPoint(e.clientX, e.clientY);
  };

  const onStickUp = (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId.current) return;
    e.preventDefault();
    stickPointerId.current = null;
    setKnob({ x: 0, y: 0, active: false });
    onStick(InputDir.Neutral, false);
  };

  const syncHeldMask = () => {
    let next = 0;
    for (const bit of btnPointers.current.values()) next |= bit;
    setHeldMask(next);
  };

  const onBtnDown = (bit: InputBit) => (e: PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement | null;
    if (target !== null) target.setPointerCapture(e.pointerId);
    btnPointers.current.set(e.pointerId, bit);
    onBit(bit, true);
    syncHeldMask();
  };

  const onBtnUp = (bit: InputBit) => (e: PointerEvent) => {
    if (btnPointers.current.get(e.pointerId) !== bit) return;
    e.preventDefault();
    btnPointers.current.delete(e.pointerId);
    let stillHeld = false;
    for (const activeBit of btnPointers.current.values()) {
      if (activeBit === bit) { stillHeld = true; break; }
    }
    if (!stillHeld) onBit(bit, false);
    syncHeldMask();
  };

  return (
    <div class="touch-pad" data-touch-controls="true" aria-label="Touch controls">
      <div
        ref={stickZoneRef}
        class={`touch-stick${knob.active ? ' active' : ''}`}
        data-touch-stick="true"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        <div class="touch-stick-ring" />
        <div class="touch-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <div class="touch-cluster">
        {ACTION_BUTTONS.map((spec) => {
          const active = (heldMask & spec.bit) !== 0;
          const highlight = spec.bit === InputBit.Use && hasGadget;
          return (
            <button
              key={spec.bit}
              type="button"
              data-touch-bit={spec.bit}
              class={`touch-btn ${spec.cls}${active ? ' active' : ''}${highlight ? ' highlight' : ''}`}
              onPointerDown={onBtnDown(spec.bit)}
              onPointerUp={onBtnUp(spec.bit)}
              onPointerCancel={onBtnUp(spec.bit)}
            >
              {spec.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
