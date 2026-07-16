export default {
  'example.record-product': {
    async execute(_context, input) {
      if (typeof input.product !== 'string' || input.product.length === 0) throw new Error('product is required');
      return { recorded: input.product };
    },
  },
};
