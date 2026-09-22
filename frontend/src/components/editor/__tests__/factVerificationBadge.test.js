/**
 * P6-B Part 13: FactVerificationBadge — the editor-header indicator for
 * blog.fact_verification. Tested in isolation (not via EditorPage, which
 * pulls in react-markdown and hits this repo's pre-existing ESM parse issue).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import FactVerificationBadge from '../FactVerificationBadge';

describe('FactVerificationBadge', () => {
  it('renders nothing when verification never ran', () => {
    const { container } = render(<FactVerificationBadge factVerification={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unrecognized status rather than guessing', () => {
    const { container } = render(<FactVerificationBadge factVerification={{ status: 'not_applicable', claims: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a verified badge and, on click, its claims', async () => {
    const user = userEvent.setup();
    render(
      <FactVerificationBadge
        factVerification={{
          status: 'verified',
          policy: 'primary_only',
          claims: [{ claim: 'Diwali is on 20 October.', status: 'verified', sourceName: 'Drik Panchang', conflictDetail: null }],
        }}
      />
    );

    expect(screen.getByText('✓ Facts Verified')).toBeInTheDocument();
    await user.click(screen.getByText('✓ Facts Verified'));

    expect(await screen.findByText('Diwali is on 20 October.')).toBeInTheDocument();
    expect(screen.getByText('Source: Drik Panchang')).toBeInTheDocument();
  });

  it('shows a conflict badge and the conflicting claim detail', async () => {
    const user = userEvent.setup();
    render(
      <FactVerificationBadge
        factVerification={{
          status: 'conflict',
          policy: 'compare_all',
          claims: [
            {
              claim: 'The festival is on 15 August.',
              status: 'conflict',
              sourceName: 'Drik Panchang',
              conflictDetail: 'A secondary source lists 16 August instead.',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('⚠ Fact Conflict')).toBeInTheDocument();
    await user.click(screen.getByText('⚠ Fact Conflict'));
    expect(await screen.findByText('A secondary source lists 16 August instead.')).toBeInTheDocument();
  });

  it('explains a failed verification run rather than showing an empty list', async () => {
    const user = userEvent.setup();
    render(
      <FactVerificationBadge factVerification={{ status: 'unverified', policy: 'primary_only', claims: [], reason: 'verification_failed' }} />
    );

    await user.click(screen.getByText('Facts Unverified'));
    expect(await screen.findByText('Verification could not run for this generation.')).toBeInTheDocument();
  });
});
