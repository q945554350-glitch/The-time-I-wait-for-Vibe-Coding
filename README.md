# 我等待 Vibe Coding 的时间

一个填满 Vibe Coding 生成间隙的五分钟浏览器肉鸽（roguelike）。

> **完全免费且开源。** 无广告、无内购、无账号系统，也不会收集任何数据。打开浏览器即可游玩。

> The time I wait for Vibe Coding: have a thrilling five-minute battle and face Merge Conflict Miss in the final minute.
>
> Completely free and open source. No ads, no in-app purchases, no account required, and no data collection.

## 为什么做这个

用 Vibe Coding 时，我们常常要等待大量的生成时间。这些碎片化的等待，正好可以让大脑放松一下。

于是我做了这个五分钟小游戏——填满每一次等待的间隙。等生成完，正好打完一局，重新回去检查结果。希望它也能帮到正在等待的你。

## 快速开始

直接双击打开 `index.html` 即可游玩。

如果浏览器对本地文件有限制，可在项目目录中启动一个本地服务器：

```bash
python3 -m http.server 8000
```

然后在浏览器访问 <http://localhost:8000>。

## 操作

| 按键 | 作用 |
| --- | --- |
| `WASD` / 方向键 | 移动 |
| `空格` | 闪身（Dash） |
| —— | 攻击会自动锁定最近的麻烦 |

## 玩法

- 每次迭代提升，从三个「模型增幅」中选择一个，逐步变强。
- 每局总共可以免费刷新两次「模型增幅」选项，也可以按 `R` 快速刷新。
- 前四分钟各有一只逐渐增强的小 Boss，击败后可以额外选择一次「模型增幅」。
- 第四分钟结束时，**合并冲突小姐**会以最终 Boss 身份登场。
- 计时到 `05:00` 后，无论战况如何，游戏都会提醒你回去检查生成结果。

## 目标

在五分钟内活下来并击败最终 Boss——正好是你等待一次 Vibe Coding 生成的时间。

## License

本项目采用 [MIT License](LICENSE)，你可以自由游玩、学习、修改和分发。
