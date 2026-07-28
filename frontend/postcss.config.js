/**
 * PostCSS pipeline for Tailwind.
 *
 * react-scripts 5 picks this file up automatically — no eject required, which is
 * why the project can use Tailwind while staying on Create React App as the spec
 * requires.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
