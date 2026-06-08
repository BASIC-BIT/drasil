import '../app/globals.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'todo',
    },
    backgrounds: {
      default: 'drasil',
      values: [{ name: 'drasil', value: '#07110d' }],
    },
    layout: 'fullscreen',
  },
};

export default preview;
