/**
 * Проверяет, является ли чат административным.
 * Нормализует оба значения к строке и сравнивает.
 */
export function isAdminChat(
  chatId: number | string | undefined,
  adminChatId: string | null,
): boolean {
  if (chatId === undefined || chatId === null) return false;
  if (adminChatId === null) return false;
  const normalizedChat = String(chatId).trim();
  const normalizedAdmin = adminChatId.trim();
  if (normalizedChat.length === 0 || normalizedAdmin.length === 0) return false;
  return normalizedChat === normalizedAdmin;
}
