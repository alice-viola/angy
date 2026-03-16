/**
 * Runtime smoke tests for NewProjectDialog and ProjectSettingsDialog
 * repo-validation UI changes. Exercises every reactive state transition
 * in a real Vue component mount (happy-dom).
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vi } from 'vitest';
import { nextTick } from 'vue';

// Mock @tauri-apps/plugin-dialog (not in global setup)
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// Must import AFTER mocks are set up
import NewProjectDialog from '@/components/home/NewProjectDialog.vue';
import ProjectSettingsDialog from '@/components/home/ProjectSettingsDialog.vue';
import { useProjectsStore } from '@/stores/projects';

// ─── Helpers ──────────────────────────────────────────────────────

function mountNewProjectDialog() {
  return mount(NewProjectDialog, {
    global: {
      stubs: { Teleport: true },
    },
  });
}

function getCreateButton(wrapper: ReturnType<typeof mount>) {
  const buttons = wrapper.findAll('button');
  return buttons.find(b => b.text().includes('Create Project'))!;
}

function getRemoveButtons(wrapper: ReturnType<typeof mount>) {
  // Remove buttons contain ✕ and are inside repo rows
  return wrapper.findAll('button').filter(b => b.text().trim() === '✕' && !b.classes().toString().includes('hover:text-[var(--text-secondary)]'));
}

function getRepoRows(wrapper: ReturnType<typeof mount>) {
  // Repo rows have the bg-raised + rounded pattern with space-y-2
  return wrapper.findAll('.bg-\\[var\\(--bg-raised\\)\\].border');
}

// ─── NewProjectDialog ─────────────────────────────────────────────

describe('NewProjectDialog repo validation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens with one empty repo row pre-populated (onMounted auto-add)', () => {
    const wrapper = mountNewProjectDialog();
    const repoNameInputs = wrapper.findAll('input[placeholder="Repo name (e.g. backend)"]');
    expect(repoNameInputs.length).toBe(1);
    const repoPathInputs = wrapper.findAll('input[placeholder="/path/to/repo"]');
    expect(repoPathInputs.length).toBe(1);
  });

  it('shows "Repositories *" label', () => {
    const wrapper = mountNewProjectDialog();
    const labels = wrapper.findAll('label');
    const repoLabel = labels.find(l => l.text().includes('Repositories *'));
    expect(repoLabel).toBeTruthy();
  });

  it('Create button is disabled when name is empty and repo path is empty', () => {
    const wrapper = mountNewProjectDialog();
    const btn = getCreateButton(wrapper);
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('Create button stays disabled when name is filled but repo path is empty', async () => {
    const wrapper = mountNewProjectDialog();
    const nameInput = wrapper.find('input[placeholder="My Project"]');
    await nameInput.setValue('Test Project');
    await nextTick();
    const btn = getCreateButton(wrapper);
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('Create button stays disabled when repo path is filled but name is empty', async () => {
    const wrapper = mountNewProjectDialog();
    const pathInput = wrapper.find('input[placeholder="/path/to/repo"]');
    await pathInput.setValue('/some/path');
    await nextTick();
    const btn = getCreateButton(wrapper);
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('Create button becomes enabled when both name and repo path are filled', async () => {
    const wrapper = mountNewProjectDialog();
    const nameInput = wrapper.find('input[placeholder="My Project"]');
    const pathInput = wrapper.find('input[placeholder="/path/to/repo"]');
    await nameInput.setValue('Test Project');
    await pathInput.setValue('/some/path');
    await nextTick();
    const btn = getCreateButton(wrapper);
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('Remove button is disabled when only one repo row exists', () => {
    const wrapper = mountNewProjectDialog();
    // Find the ✕ button inside the repo row (not the dialog close button)
    const repoRemoveButtons = wrapper.findAll('button').filter(
      b => b.text().trim() === '✕' && b.attributes('disabled') !== undefined
    );
    // There should be exactly one disabled ✕ (the repo remove, not dialog close)
    expect(repoRemoveButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('Remove button has disabled styling (opacity-20, cursor-not-allowed)', () => {
    const wrapper = mountNewProjectDialog();
    const repoRemoveBtn = wrapper.findAll('button').find(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    expect(repoRemoveBtn).toBeTruthy();
    expect(repoRemoveBtn!.classes().join(' ')).toContain('disabled:cursor-not-allowed');
  });

  it('adding a second repo row enables both Remove buttons', async () => {
    const wrapper = mountNewProjectDialog();
    // Click "+ Add Repository"
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('+ Add Repository'))!;
    await addBtn.trigger('click');
    await nextTick();

    // Now there should be 2 repo path inputs
    const repoPathInputs = wrapper.findAll('input[placeholder="/path/to/repo"]');
    expect(repoPathInputs.length).toBe(2);

    // Both remove buttons in repo rows should be enabled
    const repoRemoveButtons = wrapper.findAll('button').filter(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    for (const btn of repoRemoveButtons) {
      expect(btn.attributes('disabled')).toBeUndefined();
    }
  });

  it('removing a row back to one disables the Remove button again', async () => {
    const wrapper = mountNewProjectDialog();
    // Add second repo
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('+ Add Repository'))!;
    await addBtn.trigger('click');
    await nextTick();

    // Remove the second repo (last ✕ in repo rows)
    const removeButtons = wrapper.findAll('button').filter(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    await removeButtons[removeButtons.length - 1].trigger('click');
    await nextTick();

    // Back to 1 repo — remove button should be disabled
    const repoPathInputs = wrapper.findAll('input[placeholder="/path/to/repo"]');
    expect(repoPathInputs.length).toBe(1);

    const disabledRemove = wrapper.findAll('button').find(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20') && b.attributes('disabled') !== undefined
    );
    expect(disabledRemove).toBeTruthy();
  });

  it('clearing the repo path disables Create button again', async () => {
    const wrapper = mountNewProjectDialog();
    const nameInput = wrapper.find('input[placeholder="My Project"]');
    const pathInput = wrapper.find('input[placeholder="/path/to/repo"]');

    // Fill both
    await nameInput.setValue('Test Project');
    await pathInput.setValue('/some/path');
    await nextTick();
    expect(getCreateButton(wrapper).attributes('disabled')).toBeUndefined();

    // Clear path
    await pathInput.setValue('');
    await nextTick();
    expect(getCreateButton(wrapper).attributes('disabled')).toBeDefined();
  });
});

// ─── ProjectSettingsDialog ────────────────────────────────────────

describe('ProjectSettingsDialog repo validation', () => {
  let store: ReturnType<typeof useProjectsStore>;

  const fakeProject = {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    color: '#aabbcc',
    createdAt: '2026-01-01',
  };

  const fakeRepo = {
    id: 'repo-1',
    projectId: 'proj-1',
    name: 'my-repo',
    path: '/path/to/my-repo',
    defaultBranch: 'main',
  };

  function mountSettingsDialog(projectOverride = fakeProject) {
    return mount(ProjectSettingsDialog, {
      props: { project: projectOverride as any },
      global: {
        stubs: { Teleport: true },
      },
    });
  }

  function getSaveButton(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('button').find(b => b.text() === 'Save')!;
  }

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    store = useProjectsStore();
    // Seed the store with one repo for our project
    (store as any).$patch({ repos: [fakeRepo], projects: [fakeProject] });
  });

  it('shows "Repositories *" label with InfoTip', () => {
    const wrapper = mountSettingsDialog();
    const labels = wrapper.findAll('label');
    const repoLabel = labels.find(l => l.text().includes('Repositories *'));
    expect(repoLabel).toBeTruthy();
  });

  it('shows existing repo with its name and path', () => {
    const wrapper = mountSettingsDialog();
    expect(wrapper.text()).toContain('my-repo');
    expect(wrapper.text()).toContain('/path/to/my-repo');
  });

  it('Remove button on sole existing repo is disabled', () => {
    const wrapper = mountSettingsDialog();
    // Find the ✕ button associated with existing repo (first one after repo name)
    const removeBtn = wrapper.findAll('button').find(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    expect(removeBtn).toBeTruthy();
    expect(removeBtn!.attributes('disabled')).toBeDefined();
  });

  it('adding a new repo with non-empty path enables existing repo Remove button', async () => {
    const wrapper = mountSettingsDialog();

    // Click "+ Add Repository"
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('+ Add Repository'))!;
    await addBtn.trigger('click');
    await nextTick();

    // Fill the new repo path
    const newPathInput = wrapper.find('input[placeholder="/path/to/repo"]');
    await newPathInput.setValue('/new/repo/path');
    await nextTick();

    // Now totalReposAfterSave = 2, so existing repo's ✕ should be enabled
    const existingRemoveBtn = wrapper.findAll('button').find(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    expect(existingRemoveBtn).toBeTruthy();
    expect(existingRemoveBtn!.attributes('disabled')).toBeUndefined();
  });

  it('clearing new repo path re-disables existing repo Remove button', async () => {
    const wrapper = mountSettingsDialog();

    // Add new repo with path
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('+ Add Repository'))!;
    await addBtn.trigger('click');
    await nextTick();

    const newPathInput = wrapper.find('input[placeholder="/path/to/repo"]');
    await newPathInput.setValue('/new/repo/path');
    await nextTick();

    // Clear it
    await newPathInput.setValue('');
    await nextTick();

    // totalReposAfterSave = 1 again, so ✕ on existing should be disabled
    const existingRemoveBtn = wrapper.findAll('button').find(
      b => b.text().trim() === '✕' && b.classes().join(' ').includes('disabled:opacity-20')
    );
    expect(existingRemoveBtn).toBeTruthy();
    expect(existingRemoveBtn!.attributes('disabled')).toBeDefined();
  });

  it('new repo Remove buttons are never disabled', async () => {
    const wrapper = mountSettingsDialog();

    // Add a new repo row
    const addBtn = wrapper.findAll('button').find(b => b.text().includes('+ Add Repository'))!;
    await addBtn.trigger('click');
    await nextTick();

    // The new repo's ✕ should NOT have disabled:opacity-20 class (it uses a different class set)
    // Find buttons with ✕ that do NOT have the disabled:opacity-20 class
    const newRepoRemoveBtn = wrapper.findAll('button').filter(
      b => b.text().trim() === '✕' && !b.classes().join(' ').includes('disabled:opacity-20')
    );
    // Should find at least 1 (new repo) + 1 (dialog close)
    // The new repo remove should not have disabled attribute
    const nonDialogCloseButtons = newRepoRemoveBtn.filter(
      b => !b.classes().join(' ').includes('hover:text-[var(--text-secondary)]')
    );
    for (const btn of nonDialogCloseButtons) {
      expect(btn.attributes('disabled')).toBeUndefined();
    }
  });

  it('Save button is disabled when project name is cleared', async () => {
    const wrapper = mountSettingsDialog();
    const nameInput = wrapper.find('input[type="text"]');
    // Find the name input (first text input)
    const inputs = wrapper.findAll('input');
    const nameField = inputs[0]; // editName is the first input
    await nameField.setValue('');
    await nextTick();

    const saveBtn = getSaveButton(wrapper);
    expect(saveBtn.attributes('disabled')).toBeDefined();
  });

  it('Save button has disabled styling classes', () => {
    const wrapper = mountSettingsDialog();
    const saveBtn = getSaveButton(wrapper);
    const classes = saveBtn.classes().join(' ');
    expect(classes).toContain('disabled:opacity-40');
    expect(classes).toContain('disabled:cursor-not-allowed');
  });

  it('Save button is enabled when name is non-empty and at least one repo exists', () => {
    const wrapper = mountSettingsDialog();
    // Default state: name="Test Project", 1 existing repo
    const saveBtn = getSaveButton(wrapper);
    expect(saveBtn.attributes('disabled')).toBeUndefined();
  });
});
