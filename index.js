/**
 * Custom entry point, ahead of `expo-router/entry`.
 *
 * The only reason this file exists is ordering. `silenceChartResponderWarnings` patches
 * console.error, and React DOM records each unknown-prop warning in a `warnedProperties` map —
 * it warns once per prop name per page load and never again. So the patch has to be installed
 * before the first chart renders, or the warning has already escaped and installing it later
 * changes nothing.
 *
 * Calling it at module scope in app/_layout.tsx was not early enough: Expo Router loads route
 * modules as lazy chunks, so a route's chart could render before the root layout's module body
 * had run. Metro evaluates this entry before any route chunk, which is early enough.
 *
 * `expo-router/entry` is pulled in with require rather than import on purpose — ES imports are
 * hoisted above statements, so an `import 'expo-router/entry'` would run the whole app before
 * the patch was installed and put us back where we started.
 *
 * See lib/silenceChartWarnings.ts for why the warning exists at all.
 */
import { silenceChartResponderWarnings } from './lib/silenceChartWarnings';

silenceChartResponderWarnings();

require('expo-router/entry');
