export function addComment(entityId: string, userId: string, text: string): Promise<{ commentId: string }> {
  return Promise.resolve({ commentId: '' });
}
export function deleteComment(commentId: string): Promise<void> {
  return Promise.resolve();
}
