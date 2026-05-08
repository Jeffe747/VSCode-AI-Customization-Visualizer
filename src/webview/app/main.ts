import { mount } from 'svelte';
import App from './App.svelte';
import { WebviewBootstrapData, createDefaultBootstrapData, readBootstrapData } from './protocol';
import './styles/app.css';

const target = document.getElementById('app') ?? document.body;
const initialData = readBootstrapData() ?? createDefaultBootstrapData();

applyBootstrapColors(initialData);

const app = mount(App, {
	target,
	props: {
		initialData,
	},
});

export default app;

function applyBootstrapColors(initialData: WebviewBootstrapData): void {
	const colors = typeof initialData.settings.colors === 'object' && initialData.settings.colors ? initialData.settings.colors : {};

	for (const [key, fallback] of Object.entries(initialData.colorPickerFallbackColors)) {
		const value = typeof colors[key] === 'string' ? colors[key] : fallback;

		if (value) {
			document.documentElement.style.setProperty('--' + key, value);
		}
	}
}