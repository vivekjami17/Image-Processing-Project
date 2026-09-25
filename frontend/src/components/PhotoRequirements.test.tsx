import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoRequirements } from './PhotoRequirements';

describe('PhotoRequirements', () => {
  it('reveals the rule list when expanded', async () => {
    render(<PhotoRequirements />);
    await userEvent.click(screen.getByText('Photo Requirements'));
    expect(screen.getByText(/Exactly one face/)).toBeInTheDocument();
  });
});
