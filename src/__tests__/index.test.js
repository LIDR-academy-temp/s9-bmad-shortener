const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('src/index.js boot sequencing', () => {
  let listenMock;
  let bootstrapSchemaMock;
  let clickConsumerStartMock;
  let exitSpy;

  beforeEach(() => {
    jest.resetModules();
    listenMock = jest.fn();
    clickConsumerStartMock = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../app', () => ({ listen: listenMock }));
    jest.doMock('../services/clickConsumer', () => ({
      start: clickConsumerStartMock,
    }));
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../app');
    jest.dontMock('../repos/db');
    jest.dontMock('../services/clickConsumer');
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

  it('starts the click consumer once bootstrapSchema resolves', async () => {
    bootstrapSchemaMock = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../repos/db', () => ({ bootstrapSchema: bootstrapSchemaMock }));

    require('../index');
    await flushPromises();

    expect(clickConsumerStartMock).toHaveBeenCalledTimes(1);
  });

  it('still calls app.listen when clickConsumer.start rejects', async () => {
    bootstrapSchemaMock = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../repos/db', () => ({ bootstrapSchema: bootstrapSchemaMock }));
    clickConsumerStartMock.mockRejectedValue(new Error('consumer connect failed'));

    require('../index');
    await flushPromises();

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
