test.todo('Client should connect to appropriate public gateway');

describe('Parcel delivery', () => {
  test.todo('Pre-existing parcels should be delivered first');

  test.todo('Pre-existing, expired parcels should be deleted without attempting delivery');

  test.todo('New parcels should be delivered');

  test.todo('Successfully delivered parcels should be deleted');

  test.todo('Parcels refused as invalid should be deleted');

  test.todo('Delivery should be reattempted after 5 seconds if there was a server error');

  test.todo('Process should end if public gateway refuses delivery signature');
});
