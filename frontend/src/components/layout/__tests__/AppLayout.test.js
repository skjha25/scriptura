import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '../AppLayout';
import { useAuth } from '../../../context/AuthContext';

jest.mock('../../../context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockAuthValue = {
  user: { name: 'Test User', email: 'test@example.com', role: 'editor' },
  logout: jest.fn(),
  features: { text_provider: 'openai', image_provider: 'openai' },
};

function renderLayout() {
  useAuth.mockReturnValue(mockAuthValue);
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>
  );
}

describe('AppLayout mobile drawer', () => {
  test('opens menu on hamburger click and closes menu when clicking empty backdrop space', () => {
    renderLayout();

    // Hamburger button
    const openBtn = screen.getByRole('button', { name: /open navigation/i });
    expect(openBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(openBtn);
    expect(openBtn).toHaveAttribute('aria-expanded', 'true');

    // Find the backdrop element
    const backdrop = document.querySelector('.bg-black\\/75');
    expect(backdrop).not.toBeNull();

    // Click backdrop
    fireEvent.click(backdrop);
    expect(openBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('closes menu when clicking close X button in drawer header', () => {
    renderLayout();

    const openBtn = screen.getByRole('button', { name: /open navigation/i });
    fireEvent.click(openBtn);
    expect(openBtn).toHaveAttribute('aria-expanded', 'true');

    const closeBtn = screen.getByRole('button', { name: /close navigation$/i });
    fireEvent.click(closeBtn);
    expect(openBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
