"""UNet with a pretrained ResNet encoder, built from config keys."""

from __future__ import annotations

import segmentation_models_pytorch as smp
import torch.nn as nn

from .labels import NUM_CLASSES

# No change needed here for the new hydraulic icon classes: NUM_CLASSES is
# read from labels.py at import time, so build_model() already produces an
# 8-channel output (4 structural + 4 icon) instead of 4. See labels.py's
# module docstring for what that means for any existing checkpoint (none
# ship in this repo, but it's a breaking change for one that did).


def build_model(
    encoder_name: str = "resnet34",
    encoder_weights: str | None = "imagenet",
    num_classes: int = NUM_CLASSES,
    in_channels: int = 3,
) -> nn.Module:
    """UNet with `encoder_name` as the backbone. Returns raw logits."""
    return smp.Unet(
        encoder_name=encoder_name,
        encoder_weights=encoder_weights,
        in_channels=in_channels,
        classes=num_classes,
    )
