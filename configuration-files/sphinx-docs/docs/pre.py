"""Sphinx pre-build script to e.g. move files around before building the docs, can be customized as needed for individual repos."""
# import os
# from pathlib import Path
from logging import INFO as info
from sphinx.util import logging

logger = logging.getLogger(__name__)
logger.setLevel(info)

# Example code to create a showcases folder for Storagepy:

# logger.warning("[Sphinx pre.py] Creating directory 'showcases'")
# os.makedirs(os.path.dirname("../showcases/Basic"), exist_ok=True)
# logger.warning("[Sphinx pre.py] Creating __init__ file in 'showcases'")
# with open("../showcases/__init__.py", "x") as file:
#     file.write("\"\"\"\nShowcase examples overview\n\n:std:doc:`Back to Home <../index>`\n\"\"\"\n")

# logger.warning("[Sphinx pre.py] Creating directory 'showcases/Basic'")
# Path("../showcases/Basic").mkdir(parents=True, exist_ok=True)
# logger.warning("[Sphinx pre.py] Creating __init__ file in 'showcases/Basic'")
# with open("../showcases/Basic/__init__.py", "x") as file:
#     file.write("\"\"\"\n.. include:: ../../Showcase.ipynb\n   :parser: myst_nb.docutils_\n\"\"\"\n")

# logger.warning("[Sphinx pre.py] Creating directory 'showcases/InDepth'")
# Path("../showcases/InDepth").mkdir(parents=True, exist_ok=True)
# logger.warning("[Sphinx pre.py] Creating __init__ file in 'showcases/InDepth'")
# with open("../showcases/InDepth/__init__.py", "x") as file:
#     file.write("\"\"\"\n.. include:: ../../Showcase - In Depth.ipynb\n   :parser: myst_nb.docutils_\n\"\"\"\n")

# logger.warning("[Sphinx pre.py] Showcase framework finished! Ready to start docs build")

logger.info("[Sphinx pre.py] Nothing to prepare, ready to start docs build...")
