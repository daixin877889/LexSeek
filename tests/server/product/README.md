# 商品模块测试

## 测试文件

| 文件 | 描述 | 测试类型 |
|------|------|----------|
| product-service.test.ts | 商品服务层测试 | 单元测试 + 属性测试 |

## 测试用例

### product-service.test.ts

- **getProductByIdService 测试**
  - 应返回存在的商品信息
  - 不存在的商品应返回 null

- **getActiveProductsService 测试**
  - 应返回所有上架商品
  - 按类型筛选应只返回指定类型的商品

- **calculatePriceService 测试**
  - 会员商品年付价格计算应正确
  - 会员商品月付价格计算应正确
  - 积分商品价格计算应正确
  - 不存在的商品应抛出错误
  - 购买数量小于最小数量应抛出错误

- **checkProductPurchaseLimitService 测试**
  - 无购买限制的商品应返回 true
  - 不存在的商品应抛出错误

- **filterProductsByPurchaseLimitService 测试**
  - 无购买限制的商品应全部保留
  - 空商品列表应返回空数组

- **Property: 价格计算一致性**
  - 总价应等于单价乘以数量

## 运行命令

```bash
# 运行商品模块测试
npx vitest run tests/server/product --reporter=verbose
```
