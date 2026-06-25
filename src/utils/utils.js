export const getPromise = () => {
    let _resolve, _reject;
    const promise = new Promise((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
    });

    promise.resolve = _resolve;
    promise.reject = _reject;

    return promise;
};
