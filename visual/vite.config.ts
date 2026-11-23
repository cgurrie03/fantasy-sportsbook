import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error This small shared module is also consumed by Node release tools.
import {buildTarget} from './lib/release-target.mjs';
const target=buildTarget(process.env.BOFF_BUILD_TARGET);
export default defineConfig({ plugins: [react()], resolve: {dedupe: ['react','react-dom']},
 define:{__BOFF_RELEASE_TARGET__:JSON.stringify(target),'import.meta.env.VITE_APP_ENV':JSON.stringify(target.name)} });
