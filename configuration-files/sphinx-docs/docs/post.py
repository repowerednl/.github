"""Sphinx post-build script to e.g. move files around after building the docs, can be customized as needed for individual repos."""
# import os
# import shutil
from logging import INFO as info
from sphinx.util import logging

logger = logging.getLogger(__name__)
logger.setLevel(info)

# Example code to move notebooks and showcases into folder for Storagepy:

# logger.warning("[Sphinx post.py] Removing temporary 'build' directory and its contents...")
# try:
#     shutil.rmtree('./build')
# except FileNotFoundError:
#     logger.warning("[Sphinx post.py] Temporary 'build' directory was already removed")

# logger.warning("[Sphinx post.py] Removing temporary 'showcases' directory and its contents...")
# try:
#     shutil.rmtree('../showcases')
# except FileNotFoundError:
#     logger.warning("[Sphinx post.py] Temporary 'showcases' directory was already removed")

# logger.warning("[Sphinx post.py] Moving the generated nb.html file into the docs folder...")
# try:
#     shutil.move("../nb.html", "./_build/html/_autosummary/nb.html")
# except:
#     logger.warning("[Sphinx post.py] nb.html not found, assuming it already moved")

# logger.warning("[Sphinx post.py] Checking if file is in the right folder...")
# if os.path.isfile("./_build/html/_autosummary/nb.html"):
#     pass
# else:
#     raise FileNotFoundError("nb.html not fould in the docs/_build/html/_autosummary folder")

# logger.info("[Sphinx post.py] nb.html succesfully moved! Ready to publish docs build")

logger.info("[Sphinx post.py] Nothing to finalize post-build, finished docs.")
