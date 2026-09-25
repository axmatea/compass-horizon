// Adapted from KbWen/agent-virtual-office, movementSystem.js, revision c238a30.
// MIT: /third-party/agent-virtual-office-LICENSE.txt. No session telemetry used.
export function calcFacing(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX, dy = toY - fromY;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return 'down';
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
