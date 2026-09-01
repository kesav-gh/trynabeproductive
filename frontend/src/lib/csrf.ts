/**
 * Reads the csrf_token cookie the backend sets (see cricket-stats-game/
 * csrf.py) and turns it into the header the auth endpoints require on
 * every mutating request. The cookie is deliberately NOT HttpOnly --
 * this is the "double-submit cookie" CSRF pattern, and the whole point
 * is that only same-origin JavaScript can read it back to construct a
 * matching header; a cross-site page cannot.
 */

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

export function csrfHeaders(): Record<string, string> {
  const token = readCookie("csrf_token");
  return token ? { "X-CSRF-Token": token } : {};
}
