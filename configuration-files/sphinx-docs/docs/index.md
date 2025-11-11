<!-- Sphinx seeder file.
    Automatically creates full html when running
   "make html" in the docs folder. -->

Welcome to {{Package}}'s documentation!
=======================================
```{eval-rst}
.. autosummary::
   :toctree: _autosummary
   :template: custom-module-template.rst
   :recursive:

   <package>
```

```{include} <readme>
```

```{eval-rst}
:ref:`Elaborate site index <modindex>`
```
