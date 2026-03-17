export interface AppUser {
  id: string;
  name: string;
  avatarColor: string;
  createdAt: string;
  lastLoginAt: string;
}

const USERS_STORAGE_KEY = "graphrag_auth_users_v1";
const CURRENT_USER_STORAGE_KEY = "graphrag_auth_current_user_v1";
const AVATAR_COLORS = [
  "#2563eb",
  "#0f766e",
  "#7c3aed",
  "#ea580c",
  "#dc2626",
  "#0891b2",
];

export const DEFAULT_LOGIN_SUGGESTIONS = ["Demo", "Analyst", "Researcher"];

function normalizeUserName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function slugifyAscii(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unicodeFallbackId(input: string): string {
  const chars = Array.from(input)
    .slice(0, 12)
    .map((char) => char.codePointAt(0)?.toString(16) ?? "0");
  return `u-${chars.join("-")}`;
}

export function createUserId(name: string): string {
  const normalized = normalizeUserName(name);
  const slug = slugifyAscii(normalized);
  if (slug) {
    return slug;
  }
  return unicodeFallbackId(normalized || "demo");
}

function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function readUsersFromStorage(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsersToStorage(users: AppUser[]): void {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {}
}

function readCurrentUserIdFromStorage(): string | null {
  try {
    return localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCurrentUserIdToStorage(userId: string | null): void {
  try {
    if (userId) {
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, userId);
    } else {
      localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    }
  } catch {}
}

export function getUsers(): AppUser[] {
  return readUsersFromStorage();
}

export function getCurrentUser(): AppUser | null {
  const userId = readCurrentUserIdFromStorage();
  if (!userId) return null;
  return readUsersFromStorage().find((user) => user.id === userId) ?? null;
}

export function getCurrentUserId(): string | null {
  return getCurrentUser()?.id ?? null;
}

export function loginUser(rawName: string): AppUser {
  const name = normalizeUserName(rawName);
  if (!name) {
    throw new Error("用户名不能为空");
  }

  const userId = createUserId(name);
  const now = new Date().toISOString();
  const users = readUsersFromStorage();
  const existing = users.find((item) => item.id === userId);

  const nextUser: AppUser = existing
    ? {
        ...existing,
        name,
        lastLoginAt: now,
      }
    : {
        id: userId,
        name,
        avatarColor: getAvatarColor(userId),
        createdAt: now,
        lastLoginAt: now,
      };

  const nextUsers = [nextUser, ...users.filter((item) => item.id !== userId)];
  writeUsersToStorage(nextUsers);
  writeCurrentUserIdToStorage(userId);
  return nextUser;
}

export function switchUser(userId: string): AppUser | null {
  const users = readUsersFromStorage();
  const target = users.find((item) => item.id === userId) ?? null;
  if (!target) return null;

  writeCurrentUserIdToStorage(target.id);
  return target;
}

export function logoutUser(): void {
  writeCurrentUserIdToStorage(null);
}

export function getInitialAuthState(): { currentUser: AppUser | null; users: AppUser[] } {
  const users = readUsersFromStorage();
  const currentUserId = readCurrentUserIdFromStorage();
  return {
    currentUser: users.find((user) => user.id === currentUserId) ?? null,
    users,
  };
}
