const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('src/index.js boot sequencing', () => {
  let listenMock;
  let bootstrapSchemaMock;
  let exitSpy;

  beforeEach(() => {
    jest.resetModules();
    listenMock = jest.fn();
    jest.doMock('../app', () => ({ listen: listenMock }));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../app');
    jest.dontMock('../repos/db');
  });

  it('awaits bootstrapSchema before calling app.listen when it resolves', async () => {
    bootstrapSchemaMock = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../repos/db', () => ({ bootstrapSchema: bootstrapSchemaMock }));

    require('../index');
    await flushPromises();

    expect(bootstrapSchemaMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not call app.listen and exits with 1 when bootstrapSchema rejects', async () => {
    bootstrapSchemaMock = jest.fn().mockRejectedValue(new Error('db unreachable'));
    jest.doMock('../repos/db', () => ({ bootstrapSchema: bootstrapSchemaMock }));

    require('../index');
    await flushPromises();

    expect(bootstrapSchemaMock).toHaveBeenCalledTimes(1);
    expect(listenMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
