/* ═══════════════════════════════════════
   userId.ts — persistent user identity
   stored in localStorage, survives
   page refreshes and reconnections.
   ═══════════════════════════════════════ */

const KEY = 'go_weiqi_user_id';

export function getUserId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID?.() ??
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
    localStorage.setItem(KEY, id);
  }
  return id;
}
