import { isDemo, json } from '../_lib/core.js';
export const onRequestGet = ({ env }) => json({ demo: isDemo(env) });