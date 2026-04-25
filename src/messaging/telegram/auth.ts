export function isInAllowlist(username: string, allowedUsers: string[]): boolean {
  return allowedUsers.includes(username);
}
