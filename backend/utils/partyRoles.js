function partyRoles(student) {
  const isSupplier = !!student?.is_supplier;
  const isClient = student?.is_client;
  if (isClient === undefined || isClient === null) {
    return { is_supplier: isSupplier, is_client: !isSupplier };
  }
  return { is_supplier: isSupplier, is_client: !!isClient };
}

module.exports = { partyRoles };