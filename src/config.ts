// Get API URL from environment variable, fallback to localhost for development
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';