module.exports = {
  ipcRenderer: {
    on: jest.fn(),
  },
  shell: {
    openExternal: jest.fn()
  },
  Menu: {
    buildFromTemplate: jest.fn(x => x)
  }
};
