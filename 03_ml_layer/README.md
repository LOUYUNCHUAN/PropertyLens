# ML Layer

输入：
- 数据层产出的训练特征集

输出：
- `model_registry/` 下的版本化模型
- 价格预测结果
- 中间ML特征（可回流至数据层做下一轮训练）

推荐建模策略：
- Baseline: LightGBM/XGBoost 回归
- Advanced: Two-stage（先区域基线价格，再个体房源偏差）
- Ensemble: Tree model + 地理嵌入特征模型

评估指标：
- MAE
- MAPE
- RMSE
