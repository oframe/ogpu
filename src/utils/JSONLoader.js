// Wraps the `await (await fetch(url)).json()` double-await dance.

export const loadJSON = async (url, opts) => {
    const res = await fetch(url, opts);
    if (!res.ok) {
        throw new Error(`JSONLoader: failed to fetch ${url} (${res.status} ${res.statusText})`);
    }
    return res.json();
};

// Load many in parallel, resolves to array in same order.
export const loadJSONAll = (urls, opts) => Promise.all(urls.map((url) => loadJSON(url, opts)));
