import './styles.css';
import './script.js';
import './history.js';
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })
