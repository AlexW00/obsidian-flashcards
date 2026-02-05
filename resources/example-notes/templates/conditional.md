---
tags:
    - flashcard-template
---

{{ question }}

---

{{ answer }}

{% if notes %}

> **Notes:** {{ notes }}
> {% endif %}

{% if source %}
_Source: {{ source }}_
{% endif %}
