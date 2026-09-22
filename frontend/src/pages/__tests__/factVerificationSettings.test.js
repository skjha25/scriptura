/**
 * P6-B tests: SettingsPage's new "Fact Verification" section
 * (FactVerificationSettings.js). `../../lib/api` is auto-mocked, same
 * pattern as imageDefaultsSettings.test.js.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import SettingsPage from '../SettingsPage';
import { settingsApi, contentSettingsApi, factSourcesApi } from '../../lib/api';

jest.mock('../../lib/api');
jest.mock('../../components/agents/AgentChatWidget', () => () => null);

const WEBSITE_SOURCE = {
  id: 'src-1',
  name: 'Drik Panchang',
  sourceType: 'website',
  url: 'https://drikpanchang.com',
  contentStatus: 'full',
  priority: 'primary',
  active: true,
  tags: ['festivals'],
};

const PDF_SOURCE = {
  id: 'src-2',
  name: 'Hindu Calendar 2026',
  sourceType: 'pdf',
  fileName: 'calendar.pdf',
  contentStatus: 'unavailable',
  priority: 'secondary',
  active: true,
  tags: [],
};

function setupApi({ sources = [], policy = 'primary_only', imageDefaults = { width: 1024, height: 1024, lockAspectRatio: true } } = {}) {
  settingsApi.getTopics.mockResolvedValue([]);
  contentSettingsApi.getImageDefaults.mockResolvedValue(imageDefaults);
  factSourcesApi.list.mockResolvedValue({ sources, policy });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Fact Verification — loading, empty, error states', () => {
  it('shows an empty state when no sources are configured', async () => {
    setupApi({ sources: [] });
    renderPage();

    await screen.findByText('Fact Verification');
    expect(await screen.findByText('No fact sources yet')).toBeInTheDocument();
  });

  it('lists configured sources with type/priority/status badges', async () => {
    setupApi({ sources: [WEBSITE_SOURCE, PDF_SOURCE] });
    renderPage();

    await screen.findByText('Drik Panchang');
    expect(screen.getByText('Hindu Calendar 2026')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('Readable')).toBeInTheDocument();
    expect(screen.getByText('Not readable')).toBeInTheDocument();
  });

  it('shows a retryable error banner when loading sources fails', async () => {
    settingsApi.getTopics.mockResolvedValue([]);
    contentSettingsApi.getImageDefaults.mockResolvedValue({ width: 1024, height: 1024, lockAspectRatio: true });
    factSourcesApi.list.mockRejectedValue({ message: 'Cannot reach the server.' });
    renderPage();

    await screen.findByText('Fact Verification');
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent.includes('Cannot reach the server.'))).toBe(true);
  });
});

describe('Fact Verification — verification policy', () => {
  it('the currently saved policy is checked', async () => {
    setupApi({ sources: [], policy: 'compare_all' });
    renderPage();

    const radio = await screen.findByRole('radio', { name: /Compare all configured sources/ });
    expect(radio).toBeChecked();
  });

  it('selecting a different policy saves it immediately', async () => {
    setupApi({ sources: [], policy: 'primary_only' });
    factSourcesApi.updatePolicy.mockResolvedValue({ policy: 'compare_all' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: /Compare all configured sources/ }));

    await waitFor(() => expect(factSourcesApi.updatePolicy).toHaveBeenCalledWith('compare_all'));
  });
});

describe('Fact Verification — add source flow', () => {
  it('adding a website source calls addSource and refreshes the list', async () => {
    setupApi({ sources: [] });
    factSourcesApi.addSource.mockResolvedValue({ ...WEBSITE_SOURCE });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No fact sources yet');
    await user.click(screen.getByRole('button', { name: '+ Add Source' }));

    const modal = screen.getByRole('dialog');
    await user.type(within(modal).getByLabelText('Name'), 'Drik Panchang');
    await user.type(within(modal).getByLabelText('URL'), 'https://drikpanchang.com');

    setupApi({ sources: [WEBSITE_SOURCE] }); // what the refetch after save should return
    await user.click(within(modal).getByRole('button', { name: 'Add Source' }));

    await waitFor(() =>
      expect(factSourcesApi.addSource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Drik Panchang', sourceType: 'website', url: 'https://drikpanchang.com' })
      )
    );
    expect(await screen.findByText('Drik Panchang')).toBeInTheDocument();
  });

  it('adding a reference_text source sends referenceText, not a url', async () => {
    setupApi({ sources: [] });
    factSourcesApi.addSource.mockResolvedValue({ id: 'x', name: 'Manual note', sourceType: 'reference_text', contentStatus: 'user_provided', priority: 'secondary', active: true, tags: [] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No fact sources yet');
    await user.click(screen.getByRole('button', { name: '+ Add Source' }));
    const modal = screen.getByRole('dialog');

    await user.selectOptions(within(modal).getByLabelText('Source type'), 'reference_text');
    await user.type(within(modal).getByLabelText('Name'), 'Manual note');
    await user.type(within(modal).getByLabelText('Reference text'), 'Diwali is on 20 October.');
    await user.click(within(modal).getByRole('button', { name: 'Add Source' }));

    await waitFor(() =>
      expect(factSourcesApi.addSource).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'reference_text', referenceText: 'Diwali is on 20 October.' })
      )
    );
  });

  it('the Add Source button stays disabled until the required field for the chosen type is filled', async () => {
    setupApi({ sources: [] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No fact sources yet');
    await user.click(screen.getByRole('button', { name: '+ Add Source' }));
    const modal = screen.getByRole('dialog');

    expect(within(modal).getByRole('button', { name: 'Add Source' })).toBeDisabled();
    await user.type(within(modal).getByLabelText('Name'), 'Drik Panchang');
    expect(within(modal).getByRole('button', { name: 'Add Source' })).toBeDisabled(); // still no URL
  });

  it('uploading a document/pdf source calls uploadSource with a FormData payload', async () => {
    setupApi({ sources: [] });
    factSourcesApi.uploadSource.mockResolvedValue({ ...PDF_SOURCE });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No fact sources yet');
    await user.click(screen.getByRole('button', { name: '+ Add Source' }));
    const modal = screen.getByRole('dialog');

    await user.selectOptions(within(modal).getByLabelText('Source type'), 'pdf');
    await user.type(within(modal).getByLabelText('Name'), 'Hindu Calendar 2026');
    const file = new File(['%PDF-1.4 fake'], 'calendar.pdf', { type: 'application/pdf' });
    await user.upload(within(modal).getByLabelText('PDF file'), file);

    await user.click(within(modal).getByRole('button', { name: 'Add Source' }));

    await waitFor(() => expect(factSourcesApi.uploadSource).toHaveBeenCalledTimes(1));
    const formData = factSourcesApi.uploadSource.mock.calls[0][0];
    expect(formData instanceof FormData).toBe(true);
  });

  it('a failed add shows an error banner inside the modal and does not close it', async () => {
    setupApi({ sources: [] });
    factSourcesApi.addSource.mockRejectedValue({ message: 'Could not fetch that URL.' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No fact sources yet');
    await user.click(screen.getByRole('button', { name: '+ Add Source' }));
    const modal = screen.getByRole('dialog');

    await user.type(within(modal).getByLabelText('Name'), 'Bad Site');
    await user.type(within(modal).getByLabelText('URL'), 'https://bad.example');
    await user.click(within(modal).getByRole('button', { name: 'Add Source' }));

    expect(await within(modal).findByText('Could not fetch that URL.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Fact Verification — edit / remove / toggle', () => {
  it('editing a source only sends metadata fields', async () => {
    setupApi({ sources: [WEBSITE_SOURCE] });
    factSourcesApi.updateSource.mockResolvedValue({ ...WEBSITE_SOURCE, name: 'Renamed Source' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Drik Panchang');
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const modal = screen.getByRole('dialog');
    expect(within(modal).queryByLabelText('URL')).not.toBeInTheDocument(); // no re-fetch fields on edit
    const nameInput = within(modal).getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Source');
    await user.click(within(modal).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(factSourcesApi.updateSource).toHaveBeenCalledWith(
        'src-1',
        expect.objectContaining({ name: 'Renamed Source' })
      )
    );
  });

  it('toggling active is optimistic and calls updateSource', async () => {
    setupApi({ sources: [WEBSITE_SOURCE] });
    factSourcesApi.updateSource.mockResolvedValue({ ...WEBSITE_SOURCE, active: false });
    const user = userEvent.setup();
    renderPage();

    const nameEl = await screen.findByText('Drik Panchang');
    const card = nameEl.closest('li');
    const toggle = within(card).getByRole('checkbox');
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(toggle).not.toBeChecked(); // optimistic flip, immediate
    await waitFor(() => expect(factSourcesApi.updateSource).toHaveBeenCalledWith('src-1', { active: false }));
  });

  it('a failed toggle reverts the optimistic flip', async () => {
    setupApi({ sources: [WEBSITE_SOURCE] });
    factSourcesApi.updateSource.mockRejectedValue({ message: 'Update failed.' });
    const user = userEvent.setup();
    renderPage();

    const nameEl = await screen.findByText('Drik Panchang');
    const card = nameEl.closest('li');
    const toggle = within(card).getByRole('checkbox');
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked()); // reverted after the reload
  });

  it('removing a source requires a confirm click before calling removeSource', async () => {
    setupApi({ sources: [WEBSITE_SOURCE] });
    factSourcesApi.removeSource.mockResolvedValue();
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Drik Panchang');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(factSourcesApi.removeSource).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(factSourcesApi.removeSource).toHaveBeenCalledWith('src-1'));
    await waitFor(() => expect(screen.queryByText('Drik Panchang')).not.toBeInTheDocument());
  });

  it('canceling a remove confirmation leaves the source untouched', async () => {
    setupApi({ sources: [WEBSITE_SOURCE] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Drik Panchang');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(factSourcesApi.removeSource).not.toHaveBeenCalled();
    expect(screen.getByText('Drik Panchang')).toBeInTheDocument();
  });
});
