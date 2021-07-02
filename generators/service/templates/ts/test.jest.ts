import app from '<%= relativeRoot %><%= libDirectory %>/app';

describe('\'<%= name %>\' service', () => {
  const service = app.service('<%= path %>');
  
  it('registered the service', () => {
    expect(service).toBeTruthy();
  });
});
