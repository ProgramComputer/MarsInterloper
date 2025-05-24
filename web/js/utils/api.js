/**
 * API Utility module
 * 
 * Provides standardized methods for making API requests to the backend
 * with automatic inclusion of the API key for security.
 */

// TODO: Replace with your actual deployed Cloudflare Worker URL
const API_BASE_URL = window.API_BASE_URL || ''; // same-origin API (relative paths)
// const API_BASE_URL = 'http://localhost:8787'; // For local dev with `wrangler dev`

/**
 * Makes a GET request to the API
 * @param {string} endpoint - The API endpoint to call
 * @param {Object} params - Query parameters to include
 * @returns {Promise<any>} - The JSON response from the API
 */
export async function apiGet(endpoint, params = {}) {
    // Build query string from params
    const queryParams = new URLSearchParams(params).toString();
    const url = queryParams ? `${API_BASE_URL}${endpoint}?${queryParams}` : `${API_BASE_URL}${endpoint}`;
    
    // Include API key in headers
    const headers = {
        'X-API-Key': window.API_KEY || ''
    };
    
    // Make the request
    const response = await fetch(url, { 
        method: 'GET',
        headers
    });
    
    // Handle errors
    if (!response.ok) {
        throw new Error(`API error (${response.status}): ${response.statusText}`);
    }
    
    // Parse and return JSON response
    return await response.json();
}

/**
 * Makes a POST request to the API
 * @param {string} endpoint - The API endpoint to call
 * @param {Object} data - The data to send in the request body
 * @returns {Promise<any>} - The JSON response from the API
 */
export async function apiPost(endpoint, data = {}) {
    // Include API key in headers
    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': window.API_KEY || ''
    };
    
    // Make the request
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
    });
    
    // Handle errors
    if (!response.ok) {
        throw new Error(`API error (${response.status}): ${response.statusText}`);
    }
    
    // Parse and return JSON response
    return await response.json();
}

/**
 * Makes a PUT request to the API
 * @param {string} endpoint - The API endpoint to call
 * @param {Object} data - The data to send in the request body
 * @returns {Promise<any>} - The JSON response from the API
 */
export async function apiPut(endpoint, data = {}) {
    // Include API key in headers
    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': window.API_KEY || ''
    };
    
    // Make the request
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data)
    });
    
    // Handle errors
    if (!response.ok) {
        throw new Error(`API error (${response.status}): ${response.statusText}`);
    }
    
    // Parse and return JSON response
    return await response.json();
}

/**
 * Makes a DELETE request to the API
 * @param {string} endpoint - The API endpoint to call
 * @returns {Promise<any>} - The JSON response from the API
 */
export async function apiDelete(endpoint) {
    // Include API key in headers
    const headers = {
        'X-API-Key': window.API_KEY || ''
    };
    
    // Make the request
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'DELETE',
        headers
    });
    
    // Handle errors
    if (!response.ok) {
        throw new Error(`API error (${response.status}): ${response.statusText}`);
    }
    
    // Parse and return JSON response
    return await response.json();
} 