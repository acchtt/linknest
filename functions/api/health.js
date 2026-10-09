import { isDemo, json } from '../_lib/core.js';
export const onRequestGet = ({ env }) => json({ status: 'ok', demo: isDemo(env) });