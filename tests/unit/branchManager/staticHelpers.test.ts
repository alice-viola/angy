import { BranchManager } from '@/engine/BranchManager';

describe('BranchManager.epicTitleToSlug()', () => {
  it('converts to lowercase and replaces spaces with hyphens', () => {
    expect(BranchManager.epicTitleToSlug('Hello World')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(BranchManager.epicTitleToSlug('  Leading and trailing  ')).toBe('leading-and-trailing');
  });

  it('removes special characters', () => {
    const result = BranchManager.epicTitleToSlug('Special!@#$%Chars');
    expect(result).toMatch(/^[a-z0-9-]+$/);
    expect(result).toBe('specialchars');
  });

  it('collapses consecutive hyphens to a single hyphen', () => {
    expect(BranchManager.epicTitleToSlug('a   b---c')).toBe('a-b-c');
  });

  it('truncates to exactly 40 characters', () => {
    const result = BranchManager.epicTitleToSlug('A'.repeat(60));
    expect(result.length).toBe(40);
  });

  it('returns "untitled" for empty string', () => {
    expect(BranchManager.epicTitleToSlug('')).toBe('untitled');
  });

  it('returns "untitled" for whitespace-only string', () => {
    expect(BranchManager.epicTitleToSlug('   ')).toBe('untitled');
  });

  it('lowercases all uppercase input', () => {
    expect(BranchManager.epicTitleToSlug('ALL UPPERCASE')).toBe('all-uppercase');
  });

  it('strips unicode/accented characters', () => {
    // The regex [^a-z0-9\s-] strips non-ascii after lowercasing
    const result = BranchManager.epicTitleToSlug('café résumé');
    expect(result).toBe('caf-rsum');
  });

  it('preserves numbers', () => {
    expect(BranchManager.epicTitleToSlug('epic-123')).toBe('epic-123');
  });
});

describe('BranchManager.computeWorktreePath()', () => {
  it('strips last path segment and appends .angy-worktrees/slug', () => {
    expect(BranchManager.computeWorktreePath('/home/user/myrepo', 'my-epic'))
      .toBe('/home/user/.angy-worktrees/my-epic');
  });

  it('handles trailing slash in repoPath', () => {
    expect(BranchManager.computeWorktreePath('/home/user/myrepo/', 'my-epic'))
      .toBe('/home/user/.angy-worktrees/my-epic');
  });

  it('handles nested paths', () => {
    expect(BranchManager.computeWorktreePath('/a/b/c/repo', 'slug'))
      .toBe('/a/b/c/.angy-worktrees/slug');
  });
});

describe('BranchManager.parseGitHubUrl()', () => {
  it('parses SSH format with .git suffix', () => {
    expect(BranchManager.parseGitHubUrl('git@github.com:owner/repo.git'))
      .toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses HTTPS format with .git suffix', () => {
    expect(BranchManager.parseGitHubUrl('https://github.com/owner/repo.git'))
      .toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses HTTPS format without .git suffix', () => {
    expect(BranchManager.parseGitHubUrl('https://github.com/owner/repo'))
      .toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null for non-GitHub URL', () => {
    expect(BranchManager.parseGitHubUrl('https://gitlab.com/owner/repo.git')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(BranchManager.parseGitHubUrl('not-a-url')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(BranchManager.parseGitHubUrl('')).toBeNull();
  });
});
