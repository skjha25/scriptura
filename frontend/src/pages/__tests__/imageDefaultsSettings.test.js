/**
 * P6-A tests: SettingsPage's new "Blog Image Defaults" section
 * (ImageDefaultsSettings.js). `../../lib/api` is auto-mocked, same pattern
 * as every other *.test.js this session. Trending Topics' own existing
 * behavior is exercised incidentally (it's on the same page) but not
 * re-tested in depth here — this file focuses on the new P6-A surface.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import SettingsPage from '../SettingsPage';
import { settingsApi, contentSettingsApi } from '../../lib/api';

jest.mock('../../lib/api');
jest.mock('../../components/agents/AgentChatWidget', () => () => null);

function setupApi({ imageDefaults = { width: 1024, height: 1024, lockAspectRatio: true } } = {}) {
  settingsApi.getTopics.mockResolvedValue([]);
  contentSettingsApi.getImageDefaults.mockResolvedValue(imageDefaults);
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

describe('Blog Image Defaults — loading, current default, empty/error', () => {
  it('shows the real current default from the API, never a fabricated 1200x630', async () => {
    setupApi({ imageDefaults: { width: 1024, height: 1024, lockAspectRatio: true } });
    renderPage();

    await screen.findByText('Blog Image Defaults');
    const badge = await screen.findByText('1024 × 1024');
    expect(badge).toBeInTheDocument();
    expect(screen.getByText('1.00:1')).toBeInTheDocument();
  });

  it('reflects a previously-saved non-default value', async () => {
    setupApi({ imageDefaults: { width: 1200, height: 630, lockAspectRatio: true } });
    renderPage();

    expect(await screen.findByText('1200 × 630')).toBeInTheDocument();
    expect(screen.getByText('1.90:1')).toBeInTheDocument();
  });

  it('shows a retryable error banner when the image-defaults request fails', async () => {
    settingsApi.getTopics.mockResolvedValue([]);
    contentSettingsApi.getImageDefaults.mockRejectedValue({ message: 'Cannot reach the server.' });
    renderPage();

    await screen.findByText('Blog Image Defaults');
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent.includes('Cannot reach the server.'))).toBe(true);
  });
});

describe('Blog Image Defaults — aspect ratio lock behavior', () => {
  it('locked: changing width recalculates height to preserve the ratio', async () => {
    setupApi({ imageDefaults: { width: 1200, height: 600, lockAspectRatio: true } }); // 2:1
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1200 × 600');
    const widthInput = screen.getByLabelText('Width');
    const heightInput = screen.getByLabelText('Height');

    await user.clear(widthInput);
    await user.type(widthInput, '800');

    await waitFor(() => expect(heightInput).toHaveValue(400)); // 800 / 2 = 400
  });

  it('locked: changing height recalculates width to preserve the ratio', async () => {
    setupApi({ imageDefaults: { width: 1200, height: 600, lockAspectRatio: true } }); // 2:1
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1200 × 600');
    const widthInput = screen.getByLabelText('Width');
    const heightInput = screen.getByLabelText('Height');

    await user.clear(heightInput);
    await user.type(heightInput, '300');

    await waitFor(() => expect(widthInput).toHaveValue(600)); // 300 * 2 = 600
  });

  it('unlocked: changing width does NOT touch height', async () => {
    setupApi({ imageDefaults: { width: 1200, height: 600, lockAspectRatio: true } });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1200 × 600');
    const lockToggle = screen.getByLabelText(/Lock aspect ratio/);
    await user.click(lockToggle); // unlock

    const widthInput = screen.getByLabelText('Width');
    const heightInput = screen.getByLabelText('Height');
    await user.clear(widthInput);
    await user.type(widthInput, '900');

    expect(heightInput).toHaveValue(600); // unchanged
  });

  it('a preset button sets both dimensions and updates the ratio used for future locked edits', async () => {
    setupApi({ imageDefaults: { width: 1024, height: 1024, lockAspectRatio: true } });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1024 × 1024');
    await user.click(screen.getByRole('button', { name: /Landscape/ }));

    const widthInput = screen.getByLabelText('Width');
    const heightInput = screen.getByLabelText('Height');
    expect(widthInput).toHaveValue(1200);
    expect(heightInput).toHaveValue(630);
  });
});

describe('Blog Image Defaults — save flow', () => {
  it('Save is disabled until a value actually changes', async () => {
    setupApi({ imageDefaults: { width: 1024, height: 1024, lockAspectRatio: true } });
    renderPage();

    await screen.findByText('1024 × 1024');
    expect(screen.getByRole('button', { name: 'Save Default' })).toBeDisabled();
  });

  it('saving calls the API with the new values and shows a success confirmation', async () => {
    setupApi({ imageDefaults: { width: 1024, height: 1024, lockAspectRatio: true } });
    contentSettingsApi.updateImageDefaults.mockResolvedValue({ width: 1200, height: 630, lockAspectRatio: true });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1024 × 1024');
    await user.click(screen.getByRole('button', { name: /Landscape/ }));
    await user.click(screen.getByRole('button', { name: 'Save Default' }));

    await waitFor(() =>
      expect(contentSettingsApi.updateImageDefaults).toHaveBeenCalledWith({ width: 1200, height: 630, lockAspectRatio: true })
    );
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument();
  });

  it('a save failure shows an error banner and does not falsely claim success', async () => {
    setupApi({ imageDefaults: { width: 1024, height: 1024, lockAspectRatio: true } });
    contentSettingsApi.updateImageDefaults.mockRejectedValue({ message: 'Width must be between 200 and 2048.' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1024 × 1024');
    await user.click(screen.getByRole('button', { name: /Landscape/ }));
    await user.click(screen.getByRole('button', { name: 'Save Default' }));

    const alert = await screen.findByText('Width must be between 200 and 2048.');
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText('✓ Saved')).toBeNull();
  });
});

describe('Blog Image Defaults — live crop preview', () => {
  it('the preview label reflects the current width/height/ratio', async () => {
    setupApi({ imageDefaults: { width: 1600, height: 900, lockAspectRatio: true } });
    renderPage();

    await screen.findByText('1600 × 900');
    // The preview overlay renders its own "W × H · ratio:1" label distinct from the "Current Default" badge.
    const preview = screen.getByText((content, el) => el.tagName === 'P' && /1600 × 900 · 1\.78:1/.test(content));
    expect(preview).toBeInTheDocument();
  });
});
