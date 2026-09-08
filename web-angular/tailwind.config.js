/** @type {import('tailwindcss').Config} */

/*
 * Layer 3 of the token vocabulary. See src/styles.css for layers 1 and 2, and
 * docs/UI_SYSTEM.md section 3 for why there are three.
 *
 * `rgb(var(--token) / <alpha-value>)` rather than `var(--token)` throughout:
 * the placeholder is what keeps opacity modifiers working, and it is the reason
 * :root holds channel triplets instead of hex. Three modifiers exist today
 * (border-farm-200/60, bg-green-50/40, bg-farm-50/80) and they are this phase's
 * regression test.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{html,ts}'],

  /*
   * Class-based, not media-based, because the toggle is three-way (system /
   * light / dark) and a persisted choice has to be able to disagree with the
   * OS. Adding this key emits nothing on its own -- there is not one `dark:`
   * variant in the app yet, and the `.dark` block itself is phase 3.
   */
  darkMode: 'class',

  theme: {
    extend: {
      fontFamily: {
        /*
         * NOT AN INERT ADDITION, and the one line in this file that changes a
         * rule which is already rendering: `font-mono` is used at 34 sites
         * across 18 files. Against Tailwind's default this adds `SF Mono` and
         * drops `Monaco` and `Courier New`. On macOS `ui-monospace` resolves
         * first so the rendered result is unchanged here -- verified against
         * the phase-0 screenshots -- but the fallback order genuinely differs
         * on a platform without it.
         *
         * The mono face is load-bearing from phase 4 on: every identifier,
         * litre, rupee and date is meant to sit in it with tabular figures,
         * which is what lets an eye scan 31 rows for the anomaly.
         */
        mono: [
          'ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas',
          'Liberation Mono', 'monospace',
        ],
      },

      colors: {
        /*
         * KEPT, ON PURPOSE. Phase 2 migrates call sites to the semantic names
         * a primitive at a time, so both vocabularies have to resolve during
         * the migration -- 966 colour-utility occurrences cannot move in one
         * commit. Still literal hex, so every existing utility compiles to
         * exactly the bytes it did before. Deleted in phase 4, once nothing
         * reads it.
         */
        farm: {
          50: '#faf7f0',
          100: '#f3ecdc',
          200: '#e6d7b8',
          300: '#d4ba85',
          400: '#c29b5c',
          500: '#a87d3e',
          600: '#8a6431',
          700: '#6e4e2a',
          800: '#5b4026',
          900: '#4d3722',
        },

        // --- the semantic layer: the only thing templates should read ------
        surface: {
          page: token('surface-page'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
        },
        content: {
          primary: token('text-primary'),
          heading: token('text-heading'),
          secondary: token('text-secondary'),
          muted: token('text-muted'),
          subtle: token('text-subtle'),
          disabled: token('text-disabled'),
          onFill: token('text-on-fill'),
        },
        line: {
          hairline: token('border-hairline'),
          subtle: token('border-subtle'),
          DEFAULT: token('border-default'),
          strong: token('border-strong'),
          // A selected state, not a brand fill. See styles.css.
          selected: token('border-selected'),
        },
        brand: {
          DEFAULT: token('fill-brand'),
          hover: token('fill-brand-hover'),
          disabled: token('fill-brand-disabled'),
          badge: token('fill-badge'),
        },
        focus: token('focus-ring'),
        divider: token('divider'),

        danger: {
          bg: token('danger-bg'),
          fg: token('danger-fg'),
          // red-700, which the danger role at red-800 cannot express.
          soft: token('danger-soft'),
          line: token('danger-line'),
        },
        warning: {
          bg: token('warning-bg'),
          fg: token('warning-fg'),
          // amber-900, 13 sites one stop darker than the role.
          strong: token('warning-strong'),
          line: token('warning-line'),
        },
        success: {
          bg: token('success-bg'),
          fg: token('success-fg'),
          line: token('success-line'),
        },

        // Categorical, and not the roles. See styles.css for why.
        agent: {
          dairy: {
            bg: token('agent-dairy-bg'),
            fg: token('agent-dairy-fg'),
            line: token('agent-dairy-line'),
          },
          vendor: {
            bg: token('agent-vendor-bg'),
            fg: token('agent-vendor-fg'),
            line: token('agent-vendor-line'),
          },
          both: {
            bg: token('agent-both-bg'),
            fg: token('agent-both-fg'),
            line: token('agent-both-line'),
          },
        },

        // Its own values at equal contrast, per B3. See styles.css.
        writelog: {
          bg: token('writelog-bg'),
          fg: token('writelog-fg'),
          line: token('writelog-line'),
        },

        certainty: {
          known: token('certainty-known'),
          approx: token('certainty-approx'),
          rule: token('certainty-rule'),
          absent: token('certainty-absent'),
        },
      },
    },
  },

  /*
   * EMPTY, AND @tailwindcss/forms IS NOT COMING BACK YET. It is a global
   * base-layer restyle of every input, select, textarea, checkbox and radio,
   * and calving-form's FIRST field is a <select> whose most visible single
   * change under the plugin is a new chevron, padding and border. precision-date
   * carries a type="checkbox" it restyles completely. Both sit on the two forms
   * the five-animal trial measures, so the plugin changes their feel wholesale
   * on the eve of the measurement -- for a benefit only eleven date inputs and
   * four selects actually need, all of them on free screens. Style those four
   * and eleven explicitly instead, and revisit after the trial reports.
   * docs/UI_SYSTEM.md section 8.3.
   */
  plugins: [],
};
